import { Composer, type Context, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import {
  decodeApproval,
  type ApprovalAction,
} from "../../../core/approval/callback.js";
import {
  approvalKeyboard,
  buildApprovalCaption,
} from "../../../services/approvalService.js";
import {
  publishPending,
  type PostingDeps,
  type PublishPendingResult,
} from "../../../services/postingService.js";
import {
  deletePending,
  getPending,
  updatePendingText,
} from "../../../db/repositories/pendingPostRepository.js";
import { getPostingChannel } from "../../../db/repositories/channelRepository.js";
import { validateAnswer } from "../../../core/menu/validation.js";

/**
 * Композер одобрения постов (Шаг 5). Изолированный модуль: ловит только кнопки
 * превью (`ap:*`) и правку текста, не задевая меню/триггеры. Порт `approval_callback`
 * + `receive_edit` Python-бота.
 *
 * Чужие callback'и и текст не «съедаем» — отдаём дальше через `next()`, чтобы их
 * поймали другие композеры (меню/комменты). Состояние правки — in-memory Map по
 * админу (как в меню): эфемерно, но достаточно для единичной операции.
 */
export interface ApprovalDeps {
  prisma: PrismaClient;
  logger: Logger;
  adminId: number;
}

export function createApprovalComposer(deps: ApprovalDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { adminId } = deps;

  // adminId → id поста, для которого ждём новый текст.
  const pendingEdit = new Map<number, string>();

  const admin = composer.filter((ctx) => ctx.from?.id === adminId);

  admin.on("callback_query:data", async (ctx, next) => {
    const parsed = decodeApproval(ctx.callbackQuery.data);
    if (parsed === null) {
      await next(); // не наша кнопка — пусть ловит другой композер
      return;
    }
    // Любое нажатие кнопки одобрения отменяет режим правки текста.
    pendingEdit.delete(adminId);
    await routeApproval(ctx, deps, pendingEdit, parsed.action, parsed.id);
  });

  admin.chatType("private").on("message:text", async (ctx, next) => {
    const pendingId = pendingEdit.get(adminId);
    if (pendingId === undefined) {
      await next(); // правку не ждём — пусть текст обработает меню/комменты
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next(); // команда — не текст правки
      return;
    }
    await handleEdit(ctx, deps, pendingEdit, pendingId, ctx.message.text);
  });

  return composer;
}

/** Зависимости публикации из контекста апдейта (api берём из ctx, как в меню). */
function postingDepsOf(ctx: Context, deps: ApprovalDeps): PostingDeps {
  return {
    prisma: deps.prisma,
    logger: deps.logger,
    api: ctx.api,
    adminId: deps.adminId,
  };
}

/** Роутер кнопок превью одобрения. */
async function routeApproval(
  ctx: Context,
  deps: ApprovalDeps,
  pendingEdit: Map<number, string>,
  action: ApprovalAction,
  id: string,
): Promise<void> {
  switch (action) {
    case "pub": {
      const result = await publishPending(postingDepsOf(ctx, deps), id);
      if (result.ok) {
        await editResolved(ctx, "✅ Опубликовано!");
        await ctx.answerCallbackQuery({ text: "Опубликовано" });
      } else {
        await ctx.answerCallbackQuery({
          text: publishFailText(result),
          show_alert: true,
        });
      }
      return;
    }

    case "edit": {
      const pending = await getPending(deps.prisma, id);
      if (pending === null) {
        await editResolved(ctx, "❌ Пост уже обработан или не найден.");
        await ctx.answerCallbackQuery();
        return;
      }
      pendingEdit.set(deps.adminId, id);
      await ctx.reply("✍️ Пришли новый текст поста одним сообщением.");
      await ctx.answerCallbackQuery();
      return;
    }

    case "skip": {
      await deletePending(deps.prisma, id);
      await editResolved(ctx, "⏭ Пропущено — сегодня не публикуем.");
      await ctx.answerCallbackQuery({ text: "Пропущено" });
      return;
    }

    case "cancel": {
      await deletePending(deps.prisma, id);
      await editResolved(ctx, "❌ Отменено.");
      await ctx.answerCallbackQuery({ text: "Отменено" });
      return;
    }
  }
}

/** Применяет новый текст к посту в очереди и шлёт обновлённое превью. */
async function handleEdit(
  ctx: Context,
  deps: ApprovalDeps,
  pendingEdit: Map<number, string>,
  pendingId: string,
  text: string,
): Promise<void> {
  const result = validateAnswer(text); // те же правила: непустой, в пределах лимита
  if (!result.ok) {
    await ctx.reply(`⚠️ ${result.error}`);
    return; // остаёмся в режиме правки
  }
  const updated = await updatePendingText(deps.prisma, pendingId, result.value);
  pendingEdit.delete(deps.adminId);
  if (updated === null) {
    await ctx.reply("Пост не найден — возможно, уже обработан.");
    return;
  }
  const channel = await getPostingChannel(deps.prisma);
  const caption = buildApprovalCaption(updated, channel?.chatId ?? null);
  await ctx.reply("✍️ Текст обновлён — вот новое превью:");
  await sendPreview(ctx, caption, updated.id);
}

/** Шлёт превью новым сообщением с откатом на простой текст при кривой разметке. */
async function sendPreview(
  ctx: Context,
  caption: string,
  pendingId: string,
): Promise<void> {
  const keyboard = approvalKeyboard(pendingId);
  try {
    await ctx.reply(caption, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await ctx.reply(caption, { reply_markup: keyboard });
      return;
    }
    throw err;
  }
}

/**
 * Помечает превью обработанным: переписывает текст сообщения и убирает кнопки
 * (editMessageText без reply_markup). Ошибку «не изменено»/разметки глушим.
 */
async function editResolved(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch (err) {
    if (err instanceof GrammyError) {
      return; // сообщение могли удалить/изменить — не критично
    }
    throw err;
  }
}

/** Текст алерта при неудачной публикации. */
function publishFailText(result: Extract<PublishPendingResult, { ok: false }>): string {
  switch (result.reason) {
    case "not_found":
      return "Пост уже обработан или не найден.";
    case "no_channel":
      return "Активный канал не найден. Запусти сид: npm run seed.";
    case "no_target":
      return "Не задан канал публикации. Укажите его в «📅 Автопостинг → 📡 Указать канал».";
  }
}
