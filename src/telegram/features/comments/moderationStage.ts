import { type Context, GrammyError } from "grammy";
import {
  detectSpam,
  type SpamReason,
} from "../../../core/moderation/detectSpam.js";
import { resolveCommentChannel } from "./routing.js";
import {
  getModerationDelete,
  getModerationEnabled,
  getStopWords,
} from "../../../services/moderation/moderationSettings.js";
import type { CommentDeps, CommentStage } from "./types.js";

/**
 * Стадия модерации/антиспама (Шаг 11d) — дешёвые эвристики без AI и без токенов.
 *
 * Стоит ПЕРВОЙ в конвейере: отсекает мусор до триггеров и AI (в т.ч. чтобы AI-стадия
 * не тратила токены на ответ спамеру). Гейт: тумблер `moderation_enabled` (дефолт ВЫКЛ)
 * + отправитель не привилегированный (админа/канал не трогаем) + `detectSpam`.
 * Действие — настройка: по умолчанию только сигнал админу (прав бота не требует),
 * при тумблере `moderation_delete` — авто-удаление с мягкой деградацией, если прав нет.
 *
 * Возврат: `"handled"` только когда сообщение реально удалено (стоп-конвейер), иначе
 * `"pass"` — чтобы нормальные комменты дошли до триггеров/AI. Категория `borderline`
 * (токсичность) — хук под Шаг 11e.
 */

/** Человекочитаемая причина для сигнала админу. */
const REASON_LABEL: Record<SpamReason, string> = {
  link: "ссылка",
  mentions: "флуд упоминаний",
  repeat: "растянутый текст",
  stopword: "стоп-слово",
};

export function createModerationStage(): CommentStage {
  return {
    name: "moderation",
    async handle(ctx, deps) {
      const message = ctx.message;
      const from = ctx.from;
      if (message?.text === undefined || from === undefined) {
        return "pass";
      }

      // Резолв «своего» канала (общий с триггер/AI-стадиями). null → pass.
      const routed = await resolveCommentChannel(ctx, deps);
      if (routed === null) {
        return "pass";
      }
      const channelId = routed.id;

      // Тумблер фичи (дефолт ВЫКЛ) — дешёвая проверка до всего остального.
      const enabled = await getModerationEnabled(deps.prisma, channelId);
      if (!enabled) {
        return "pass";
      }

      // Привилегированный отправитель — бот/аноним/канал (автопересылка) или владелец.
      const isPrivileged = from.is_bot === true || from.id === deps.adminId;
      const stopWords = await getStopWords(deps.prisma, channelId);
      const verdict = detectSpam({
        text: message.text,
        isPrivileged,
        stopWords,
      });
      if (!verdict.spam) {
        return "pass";
      }

      // Спам найден. Пытаемся удалить, если включено авто-удаление и есть права.
      let deleted = false;
      if (await getModerationDelete(deps.prisma, channelId)) {
        deleted = await tryDelete(ctx, deps);
      }

      // Сигнал админу в любом случае (даже когда удалили — чтобы владелец видел).
      await notifyAdmin(ctx, deps, verdict.reason, deleted);

      // Строго по ТЗ: handled только при удалении; иначе pass.
      return deleted ? "handled" : "pass";
    },
  };
}

/**
 * Пытается удалить коммент. Нет прав/иная ошибка Telegram → лог + `false`
 * (мягкая деградация: сигнал админу всё равно уйдёт). Прочие ошибки — пробрасываем.
 */
async function tryDelete(ctx: Context, deps: CommentDeps): Promise<boolean> {
  try {
    await ctx.deleteMessage();
    return true;
  } catch (err) {
    if (err instanceof GrammyError) {
      deps.logger.warn(
        { err: err.description },
        "модерация: не удалось удалить спам (нет прав?) — только сигнал",
      );
      return false;
    }
    throw err;
  }
}

/** Строит ссылку на коммент в группе обсуждений (t.me/c/... для супергрупп). */
function buildCommentLink(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (chatId === undefined || messageId === undefined) {
    return null;
  }
  // Супергруппы: -100XXXXXXXXXX → t.me/c/XXXXXXXXXX/<msgId>.
  const raw = String(chatId);
  if (!raw.startsWith("-100")) {
    return null;
  }
  return `https://t.me/c/${raw.slice(4)}/${messageId}`;
}

/** Шлёт сигнал админу о спаме. Ошибка разметки → ретрай без Markdown (как sendToAdmin). */
async function notifyAdmin(
  ctx: Context,
  deps: CommentDeps,
  reason: SpamReason,
  deleted: boolean,
): Promise<void> {
  const from = ctx.from;
  const author =
    from === undefined
      ? "неизвестный"
      : from.username !== undefined
        ? `@${from.username}`
        : `${from.first_name} (id ${from.id})`;
  const action = deleted ? "🗑 удалён" : "⚠️ оставлен (нет авто-удаления/прав)";
  const link = buildCommentLink(ctx);
  const snippet = (ctx.message?.text ?? "").slice(0, 200);
  const text =
    `🛡 *Модерация*: спам в комментах\n` +
    `Причина: ${REASON_LABEL[reason]}\n` +
    `Автор: ${author}\n` +
    `Действие: ${action}\n` +
    (link !== null ? `Коммент: ${link}\n` : "") +
    `\n${snippet}`;
  try {
    await ctx.api.sendMessage(deps.adminId, text, { parse_mode: "Markdown" });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await ctx.api.sendMessage(deps.adminId, text);
      return;
    }
    deps.logger.error({ err }, "модерация: не смог отправить сигнал админу");
  }
}
