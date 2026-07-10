import type { Context } from "grammy";
import {
  matchChannelBySenderChat,
  resolveCommentChannel as pickCommentChannel,
  type RoutableChannel,
} from "../../../core/comments/routeChannel.js";
import {
  findChannelIdByDiscussionGroup,
  getActiveRoutableChannels,
  setDiscussionGroup,
} from "../../../db/repositories/channelRepository.js";
import type { CommentDeps } from "./types.js";

/**
 * Маршрутизация комментария к «своему» каналу (Шаг 8c) — общий шаг для стадий
 * триггеров (пул готовых текстов) и AI-ответа (Шаг 11c). Вынесено из `triggerStage`,
 * чтобы обе стадии резолвили канал одинаково и без дублирования.
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
  return channel;
}
