import { Composer, type Context, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import {
  decodeApproval,
  type ApprovalAction,
} from "../../../core/approval/callback.js";
import { buildApprovalCaption } from "../../../services/approvalService.js";
import {
  photoRefFromCache,
  publishPending,
  sendApprovalPreview,
  sendPendingPreview,
  type PostingDeps,
  type PublishPendingResult,
} from "../../../services/postingService.js";
import { fetchPhotoUrl } from "../../../services/mediaService.js";
import {
  deletePending,
  getPending,
  setPendingPhoto,
  updatePendingText,
} from "../../../db/repositories/pendingPostRepository.js";
import {
  getOwnerTelegramIdByChannelId,
  getPostingChannelById,
} from "../../../db/repositories/channelRepository.js";
import { getPostPhotoSources } from "../../../db/repositories/postRepository.js";
import { validateAnswer } from "../../../core/menu/validation.js";
import { canActOnChannel } from "../../../core/approval/access.js";
import type { OwnerBotRegistry } from "../../../services/botRegistry.js";

/**
 * Композер одобрения постов (Шаг 5 + фото Шаг 6a). Изолированный модуль: ловит
 * только кнопки превью (`ap:*`), правку текста и присланное фото, не задевая
 * меню/триггеры. Порт `approval_callback` + `receive_edit` + `receive_photo`.
 *
 * Шаг 14b-2 (мультитенант): вместо фильтра «только супервладелец» — проверка
 * принадлежности поста: `ap:*` несёт id поста очереди, действовать над ним может
 * ТОЛЬКО владелец его канала (канал без владельца → супервладелец). Режимы ввода
 * (правка текста / своё фото) ключуются по нажавшему, а не по одному `adminId`.
 *
 * Чужие callback'и/текст/фото не «съедаем» — отдаём дальше через `next()`.
 */
export interface ApprovalDeps {
  prisma: PrismaClient;
  logger: Logger;
  // Супервладелец (`ADMIN_ID`) — фолбэк-адресат/решала для каналов без владельца.
  adminId: number;
  pexelsApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  timeoutMs?: number | undefined; // Шаг 11b: таймаут вызова Claude (мс); undefined → дефолт
  // Шаг 14b-bis-3: реестр ботов клиентов — публикация одобренного поста идёт ботом
  // владельца КАНАЛА поста, а не тем, в котором нажали кнопку.
  ownerBots?: OwnerBotRegistry | undefined;
}

export function createApprovalComposer(deps: ApprovalDeps): Composer<Context> {
  const composer = new Composer<Context>();

  // user id → id поста: ждём новый текст (pendingEdit) либо новое фото (pendingPhoto).
  const pendingEdit = new Map<number, string>();
  const pendingPhoto = new Map<number, string>();

  composer.on("callback_query:data", async (ctx, next) => {
    const parsed = decodeApproval(ctx.callbackQuery.data);
    if (parsed === null) {
      await next(); // не наша кнопка — пусть ловит другой композер
      return;
    }
    const userId = ctx.from.id;
    // Проверка принадлежности (14b-2): пост очереди → канал → владелец. Обработанный
    // пост (null) пропускаем к роутеру — его ветки отвечают «уже обработан», ничего
    // не раскрывая. Ответ «чужому» — тот же нейтральный текст, что и для пропавшего.
    const pending = await getPending(deps.prisma, parsed.id);
    if (pending !== null) {
      const ownerTelegramId = await getOwnerTelegramIdByChannelId(
        deps.prisma,
        pending.channelId,
      );
      if (!canActOnChannel(userId, ownerTelegramId, deps.adminId)) {
        await ctx.answerCallbackQuery({
          text: "Пост уже обработан или не найден.",
          show_alert: true,
        });
        return;
      }
    }
    // Любое нажатие кнопки одобрения отменяет режимы ввода нажавшего.
    pendingEdit.delete(userId);
    pendingPhoto.delete(userId);
    await routeApproval(
      ctx,
      deps,
      { pendingEdit, pendingPhoto },
      parsed.action,
      parsed.id,
      userId,
    );
  });

  composer.chatType("private").on("message:text", async (ctx, next) => {
    const pendingId = pendingEdit.get(ctx.from.id);
    if (pendingId === undefined) {
      await next(); // правку не ждём — пусть текст обработает меню/комменты
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next(); // команда — не текст правки
      return;
    }
    await handleEdit(ctx, deps, pendingEdit, ctx.from.id, pendingId, ctx.message.text);
  });

  composer.chatType("private").on("message:photo", async (ctx, next) => {
    const pendingId = pendingPhoto.get(ctx.from.id);
    if (pendingId === undefined) {
      await next(); // фото не ждём — не наше сообщение
      return;
    }
    await handleOwnPhoto(ctx, deps, pendingPhoto, ctx.from.id, pendingId);
  });

  return composer;
}

/** Карты режимов ввода (передаём вместе, чтобы взаимно сбрасывать). */
interface InputModes {
  readonly pendingEdit: Map<number, string>;
  readonly pendingPhoto: Map<number, string>;
}

/** Зависимости публикации из контекста апдейта (api берём из ctx, как в меню). */
function postingDepsOf(ctx: Context, deps: ApprovalDeps): PostingDeps {
  return {
    prisma: deps.prisma,
    logger: deps.logger,
    api: ctx.api,
    // Шаг 14b-bis-3: публикация одобренного поста — ботом владельца канала.
    ownerBots: deps.ownerBots,
    adminId: deps.adminId,
    pexelsApiKey: deps.pexelsApiKey,
    anthropicApiKey: deps.anthropicApiKey,
    timeoutMs: deps.timeoutMs,
  };
}

/** Цель публикации канала поста (для подписи превью — куда уйдёт, Шаг 8b). */
async function currentTarget(
  deps: ApprovalDeps,
  channelId: string,
): Promise<string | null> {
  const channel = await getPostingChannelById(deps.prisma, channelId);
  return channel?.chatId ?? null;
}

/** Роутер кнопок превью одобрения. `userId` — нажавший (ключ режимов ввода). */
async function routeApproval(
  ctx: Context,
  deps: ApprovalDeps,
  modes: InputModes,
  action: ApprovalAction,
  id: string,
  userId: number,
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
      modes.pendingEdit.set(userId, id);
      await ctx.reply("✍️ Пришли новый текст поста одним сообщением.");
      await ctx.answerCallbackQuery();
      return;
    }

    case "reroll":
      await handleReroll(ctx, deps, id);
      return;

    case "preview": {
      // 10c: пост «как в канале» приходит отдельным сообщением; превью одобрения
      // с кнопками не трогаем. У AI-поста своих кнопок нет — будет текст+фото.
      const result = await sendPendingPreview(postingDepsOf(ctx, deps), id);
      await ctx.answerCallbackQuery(
        result.ok
          ? { text: "👀 Предпросмотр отправлен ниже" }
          : { text: "Пост уже обработан или не найден.", show_alert: true },
      );
      return;
    }

    case "own": {
      const pending = await getPending(deps.prisma, id);
      if (pending === null) {
        await editResolved(ctx, "❌ Пост уже обработан или не найден.");
        await ctx.answerCallbackQuery();
        return;
      }
      modes.pendingPhoto.set(userId, id);
      await ctx.reply("🖼 Пришли своё фото одним сообщением.");
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

/** «🔄 Другое фото»: перевыбрать у провайдера по запросу поста и показать заново. */
async function handleReroll(ctx: Context, deps: ApprovalDeps, id: string): Promise<void> {
  const pending = await getPending(deps.prisma, id);
  if (pending === null) {
    await editResolved(ctx, "❌ Пост уже обработан или не найден.");
    await ctx.answerCallbackQuery();
    return;
  }
  // Запрос для подбора фото: у планового поста — из контент-плана (прежний путь);
  // у AI-поста (externalId=null, Шаг 10b) — из снимка очереди `pending.pexelsQuery`.
  const query =
    pending.externalId === null
      ? pending.pexelsQuery
      : (await getPostPhotoSources(deps.prisma, pending.channelId, pending.externalId))
          ?.pexelsQuery ?? null;
  if (query === null || query === "") {
    await ctx.answerCallbackQuery({
      text: "У этого поста нет запроса для подбора фото.",
      show_alert: true,
    });
    return;
  }
  const url = await fetchPhotoUrl(postingDepsOf(ctx, deps), pending.channelId, query);
  if (url === null) {
    await ctx.answerCallbackQuery({
      text: "Не удалось подобрать фото (нет ключа Pexels или пустая выдача).",
      show_alert: true,
    });
    return;
  }
  const updated = await setPendingPhoto(deps.prisma, id, url);
  if (updated === null) {
    await ctx.answerCallbackQuery({ text: "Пост уже обработан." });
    return;
  }
  await editResolved(ctx, "🔄 Подобрано другое фото — новое превью ниже:");
  await sendApprovalPreview(
    postingDepsOf(ctx, deps),
    updated.channelId,
    buildApprovalCaption(updated, await currentTarget(deps, updated.channelId)),
    id,
    photoRefFromCache(url),
  );
  await ctx.answerCallbackQuery({ text: "Фото обновлено" });
}

/** «🖼 Своё фото»: берём file_id присланной картинки и перерисовываем превью. */
async function handleOwnPhoto(
  ctx: Context,
  deps: ApprovalDeps,
  pendingPhoto: Map<number, string>,
  userId: number,
  pendingId: string,
): Promise<void> {
  pendingPhoto.delete(userId);
  const photos = ctx.message?.photo ?? [];
  const fileId = photos[photos.length - 1]?.file_id;
  if (fileId === undefined) {
    await ctx.reply("Не удалось прочитать фото — пришли картинку ещё раз.");
    return;
  }
  const updated = await setPendingPhoto(deps.prisma, pendingId, fileId);
  if (updated === null) {
    await ctx.reply("Пост не найден — возможно, уже обработан.");
    return;
  }
  await ctx.reply("🖼 Фото обновлено — вот новое превью:");
  await sendApprovalPreview(
    postingDepsOf(ctx, deps),
    updated.channelId,
    buildApprovalCaption(updated, await currentTarget(deps, updated.channelId)),
    pendingId,
    photoRefFromCache(fileId),
  );
}

/** Применяет новый текст к посту в очереди и шлёт обновлённое превью (с фото). */
async function handleEdit(
  ctx: Context,
  deps: ApprovalDeps,
  pendingEdit: Map<number, string>,
  userId: number,
  pendingId: string,
  text: string,
): Promise<void> {
  const result = validateAnswer(text); // те же правила: непустой, в пределах лимита
  if (!result.ok) {
    await ctx.reply(`⚠️ ${result.error}`);
    return; // остаёмся в режиме правки
  }
  const updated = await updatePendingText(deps.prisma, pendingId, result.value);
  pendingEdit.delete(userId);
  if (updated === null) {
    await ctx.reply("Пост не найден — возможно, уже обработан.");
    return;
  }
  await ctx.reply("✍️ Текст обновлён — вот новое превью:");
  await sendApprovalPreview(
    postingDepsOf(ctx, deps),
    updated.channelId,
    buildApprovalCaption(updated, await currentTarget(deps, updated.channelId)),
    updated.id,
    photoRefFromCache(updated.photoUrl),
  );
}

/**
 * Помечает превью обработанным: убирает кнопки и переписывает текст/подпись.
 * Сообщение могло быть с фото (тогда у него подпись, а не текст) — пробуем оба.
 */
async function editResolved(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.editMessageText(text);
    return;
  } catch (err) {
    if (!(err instanceof GrammyError)) {
      throw err;
    }
  }
  try {
    await ctx.editMessageCaption({ caption: text });
  } catch (err) {
    if (!(err instanceof GrammyError)) {
      throw err; // сообщение могли удалить/изменить — иные ошибки не критичны
    }
  }
}

/** Текст алерта при неудачной публикации. */
function publishFailText(result: Extract<PublishPendingResult, { ok: false }>): string {
  switch (result.reason) {
    case "not_found":
      return "Пост уже обработан или не найден.";
    case "no_channel":
      return "Канал этого поста не найден (возможно, удалён). Открой «📡 Каналы».";
    case "no_target":
      return "Не задан канал публикации. Укажи его в «📅 Автопостинг → 🎯 Канал публикации».";
  }
}
