import type { Context } from "grammy";
import {
  matchChannelBySenderChat,
  resolveCommentChannel as pickCommentChannel,
  type RoutableChannel,
} from "../../../core/comments/routeChannel.js";
import { shouldHandleComment } from "../../../core/comments/commentAuthority.js";
import { parseBotOwnerUserId } from "../../../core/bots/botStartup.js";
import {
  findChannelIdByDiscussionGroup,
  getActiveRoutableChannels,
  setDiscussionGroup,
} from "../../../db/repositories/channelRepository.js";
import type { CommentDeps } from "./types.js";

/**
 * Маршрутизация комментария к «своему» каналу (Шаг 8c). С аудита 2026-07 зовётся
 * ОДИН раз из композера (`index.ts`) перед конвейером стадий — раньше каждая из трёх
 * стадий резолвила сама (до 6 SELECT'ов на коммент), теперь готовый канал приходит
 * в `stage.handle` параметром.
 *
 * Поток: активные каналы → выученная связь группа↔канал → origin-канал
 * автопересланного поста (`sender_chat`) → фолбэк на первый активный канал. Побочно
 * ИДЕМПОТЕНТНО дообучает связь группа↔канал, когда канал опознан по `sender_chat`.
 * Возвращает `RoutableChannel` или `null`, если резолв невозможен.
 */
export async function resolveCommentChannel(
  ctx: Context,
  deps: CommentDeps,
): Promise<RoutableChannel | null> {
  const channels = await getActiveRoutableChannels(deps.prisma);
  if (channels.length === 0) {
    return null;
  }
  const groupId = String(ctx.chat?.id ?? "");
  const learnedId = await findChannelIdByDiscussionGroup(deps.prisma, groupId);
  const reply = ctx.message?.reply_to_message;
  const senderChat =
    reply?.is_automatic_forward === true ? reply.sender_chat : undefined;
  const senderChatMatch = matchChannelBySenderChat(
    senderChat === undefined
      ? null
      : {
          id: senderChat.id,
          ...(senderChat.username !== undefined && {
            username: senderChat.username,
          }),
        },
    channels,
  );
  const channel = pickCommentChannel(learnedId, senderChatMatch, channels);
  if (channel === null) {
    return null;
  }
  // Авто-обучение: канал опознан по sender_chat, а группа ещё не привязана к нему.
  if (senderChatMatch !== null && learnedId !== channel.id && groupId !== "") {
    await setDiscussionGroup(deps.prisma, channel.id, groupId);
  }
  // Шаг 14b-bis-4: разграничение общий/клиентский бот. Коммент в обсуждении получают
  // ОБА бота; здесь решаем, чей он. «Не мой» → null, и все три стадии молчат (для них
  // null уже означает «pass»). Это же автоматически переносит на бота клиента модерацию
  // и AI-ответы — они резолвят канал через этот же путь.
  if (!isCommentForThisBot(channel, deps)) {
    return null;
  }
  return channel;
}

/**
 * Гейт принадлежности коммента (Шаг 14b-bis-4). Достаёт из резолвнутого канала
 * владельца, узнаёт по реестру, поднят ли у него свой бот, и передаёт факты чистому
 * решателю `shouldHandleComment`. Реестра нет (мультибот не собран) — как раньше:
 * общий бот отвечает, у бота клиента реестр всегда есть.
 */
function isCommentForThisBot(
  channel: RoutableChannel,
  deps: CommentDeps,
): boolean {
  const channelOwnerTelegramId =
    channel.ownerTelegramUserId === null
      ? null
      : parseBotOwnerUserId(channel.ownerTelegramUserId);
  const channelOwnerHasClientBot =
    channel.ownerId !== null &&
    deps.ownerBots?.getApi(channel.ownerId) !== undefined;
  return shouldHandleComment({
    clientOwnerUserId: deps.clientOwnerUserId,
    channelOwnerTelegramId,
    channelOwnerHasClientBot,
  });
}
