import { type Context, GrammyError } from "grammy";
import {
  detectSpam,
  type SpamReason,
} from "../../../core/moderation/detectSpam.js";
import { shouldCheckToxicity } from "../../../core/moderation/buildToxicityPrompt.js";
import { buildPostLink } from "../../../core/analytics/postLink.js";
import { localDateParts } from "../../../core/schedule/localDate.js";
import { resolveOwnerTarget } from "../../../core/approval/access.js";
import {
  getOwnerTelegramIdByChannelId,
  getReplyChannelById,
} from "../../../db/repositories/channelRepository.js";
import { tryConsumeDailyBudget } from "../../../services/ai/aiBudget.js";
import {
  getModerationDelete,
  getModerationEnabled,
  getStopWords,
  getToxicityEnabled,
  getToxicityPolicy,
} from "../../../services/moderation/moderationSettings.js";
import { classifyToxicity } from "../../../services/moderation/toxicityService.js";
import type { CommentDeps, CommentStage } from "./types.js";

/**
 * Стадия модерации/антиспама — стоит ПЕРВОЙ в конвейере. Два слоя:
 * - Шаг 11d: дешёвые эвристики `detectSpam` (ссылки/флуд/повторы/стоп-слова) — 0 токенов.
 * - Шаг 11e: семантическая токсичность через Haiku (`classifyToxicity`) — платно, только
 *   для «внешне чистых» комментов, под тумблером + общим дневным бюджетом (как AI-ответы).
 *
 * Гейт: тумблер `moderation_enabled` + отправитель не привилегированный (админа/канал не
 * трогаем). Действие — настройка: по умолчанию сигнал админу (прав бота не требует), при
 * `moderation_delete` — авто-удаление с мягкой деградацией. Возврат `"handled"` только когда
 * сообщение реально удалено (стоп-конвейер), иначе `"pass"` — нормальные комменты идут дальше.
 */

/** Человекочитаемая причина спама для сигнала админу. */
const REASON_LABEL: Record<SpamReason, string> = {
  link: "ссылка",
  mentions: "флуд упоминаний",
  repeat: "растянутый текст",
  stopword: "стоп-слово",
};

export function createModerationStage(): CommentStage {
  return {
    name: "moderation",
    async handle(ctx, deps, channel) {
      const message = ctx.message;
      const from = ctx.from;
      if (message?.text === undefined || from === undefined) {
        return "pass";
      }
      const text = message.text;
      const channelId = channel.id;

      // Тумблер фичи (дефолт ВЫКЛ) — дешёвая проверка до всего остального.
      const enabled = await getModerationEnabled(deps.prisma, channelId);
      if (!enabled) {
        return "pass";
      }

      // Шаг 14b-2: адресат сигнала — владелец КАНАЛА, без владельца — супервладелец.
      const ownerTelegramId = await getOwnerTelegramIdByChannelId(
        deps.prisma,
        channelId,
      );
      const notifyTarget = resolveOwnerTarget(ownerTelegramId, deps.adminId);

      // Привилегированный отправитель — бот/аноним/канал (автопересылка), владелец
      // канала или супервладелец (он ведёт каналы без владельца и чинит чужие).
      const isPrivileged =
        from.is_bot === true ||
        from.id === notifyTarget ||
        from.id === deps.adminId;

      // Слой 1 (11d): дешёвые эвристики, 0 токенов.
      const stopWords = await getStopWords(deps.prisma, channelId);
      const verdict = detectSpam({ text, isPrivileged, stopWords });
      if (verdict.spam) {
        return enforce(
          ctx,
          deps,
          channelId,
          REASON_LABEL[verdict.reason],
          notifyTarget,
        );
      }

      // Слой 2 (11e): семантическая токсичность через Haiku. Ворота дёшево→дорого.
      return checkToxicity(ctx, deps, channelId, text, isPrivileged, notifyTarget);
    },
  };
}

/**
 * Платный слой токсичности (Шаг 11e). Зовётся только для «не спам» комментов. Ворота
 * от дешёвых к дорогим: привилегия → тумблер → пред-фильтр → бюджет → вызов Haiku.
 * Любой отказ/ошибка → `"pass"` (молчим).
 */
async function checkToxicity(
  ctx: Context,
  deps: CommentDeps,
  channelId: string,
  text: string,
  isPrivileged: boolean,
  notifyTarget: number,
): Promise<"handled" | "pass"> {
  if (isPrivileged) {
    return "pass";
  }
  if (!(await getToxicityEnabled(deps.prisma, channelId))) {
    return "pass";
  }
  // Дешёвый пред-фильтр (0 токенов): не гоняем модель на эмодзи/односимвольные комменты.
  if (!shouldCheckToxicity(text)) {
    return "pass";
  }
  // Поля канала (ниша/тон/язык/TZ) — ленивый фетч, раз дошли до платного слоя.
  const channel = await getReplyChannelById(deps.prisma, channelId);
  if (channel === null) {
    return "pass";
  }
  // Дневной бюджет (общий с AI-ответами). Списываем ДО вызова — жёсткая защита от расхода.
  const today = localDateParts(new Date(), channel.timezone).isoDate;
  const withinBudget = await tryConsumeDailyBudget(deps.prisma, channelId, today);
  if (!withinBudget) {
    deps.logger.info({ channelId }, "модерация токсичности: дневной бюджет исчерпан");
    return "pass";
  }
  const policy = await getToxicityPolicy(deps.prisma, channelId);
  const result = await classifyToxicity(
    {
      logger: deps.logger,
      apiKey: deps.anthropicApiKey,
      timeoutMs: deps.timeoutMs,
    },
    {
      channelTitle: channel.title,
      niche: channel.niche,
      toneOfVoice: channel.toneOfVoice,
      language: channel.language,
      policy,
      comment: text,
    },
  );
  if (result === null || !result.toxic) {
    return "pass";
  }
  return enforce(
    ctx,
    deps,
    channelId,
    `токсичность: ${result.reason}`,
    notifyTarget,
  );
}

/**
 * Применяет действие модерации: при включённом `moderation_delete` пытается удалить
 * коммент, сигнал админу шлёт ВСЕГДА. Возврат `"handled"` только когда реально удалили
 * (стоп-конвейер), иначе `"pass"`. Общий для спам- и токсичного слоёв.
 */
async function enforce(
  ctx: Context,
  deps: CommentDeps,
  channelId: string,
  reasonLabel: string,
  notifyTarget: number,
): Promise<"handled" | "pass"> {
  let deleted = false;
  if (await getModerationDelete(deps.prisma, channelId)) {
    deleted = await tryDelete(ctx, deps);
  }
  await notifyOwner(ctx, deps, reasonLabel, deleted, notifyTarget);
  return deleted ? "handled" : "pass";
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
        "модерация: не удалось удалить (нет прав?) — только сигнал",
      );
      return false;
    }
    throw err;
  }
}

/**
 * Строит ссылку на коммент в группе обсуждений. Правило `-100…` → `t.me/c/…` живёт в
 * ядре (`buildPostLink`) — здесь только достаём id из grammY-контекста.
 */
function buildCommentLink(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (chatId === undefined || messageId === undefined) {
    return null;
  }
  return buildPostLink({ username: null, chatId: String(chatId) }, messageId);
}

/**
 * Шлёт сигнал о нарушении владельцу канала (Шаг 14b-2; `notifyTarget` уже разрешён
 * через `resolveOwnerTarget`). Ошибка разметки → ретрай без Markdown (как sendToAdmin).
 */
async function notifyOwner(
  ctx: Context,
  deps: CommentDeps,
  reasonLabel: string,
  deleted: boolean,
  notifyTarget: number,
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
    `🛡 *Модерация*: подозрительный коммент\n` +
    `Причина: ${reasonLabel}\n` +
    `Автор: ${author}\n` +
    `Действие: ${action}\n` +
    (link !== null ? `Коммент: ${link}\n` : "") +
    `\n${snippet}`;
  try {
    await ctx.api.sendMessage(notifyTarget, text, { parse_mode: "Markdown" });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await ctx.api.sendMessage(notifyTarget, text);
      return;
    }
    deps.logger.error({ err }, "модерация: не смог отправить сигнал владельцу");
  }
}
