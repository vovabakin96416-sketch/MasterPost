/**
 * Маршрутизация комментария к нужному каналу (Шаг 8c) — ЧИСТАЯ логика, без БД/Telegram.
 *
 * Схема БД мультиканальна, но триггеры в комментах исторически вели ПЕРВЫЙ активный
 * канал. Здесь решаем, какому каналу принадлежит коммент, по убыванию надёжности:
 *   1) выученная связь «группа обсуждения → канал» (см. `learnedId`);
 *   2) `sender_chat` автопересланного корневого поста (origin-канал);
 *   3) фолбэк — первый канал списка (прежнее одноканальное поведение).
 */

/** Ключ настройки `Setting`, в которой живёт выученная связь группа↔канал. */
export const DISCUSSION_GROUP_SETTING = "discussion_chat_id";

/** Канал в форме, нужной маршрутизации комментов: id + идентификаторы + слова-триггеры. */
export interface RoutableChannel {
  id: string;
  username: string | null; // "@sofia_gada1ka"
  chatId: string | null; // "@sofia_gada1ka" или числовой "-100…"
  triggerWords: string[];
}

/** Срез `reply_to_message.sender_chat` — origin-канал автопересланного поста. */
export interface SenderChatRef {
  id: number;
  username?: string; // без ведущего "@"
}

/** Каноничная форма идентификатора канала: нижний регистр без ведущего "@". */
function normalizeId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

/**
 * Сопоставляет origin-канал автопересланного поста (`sender_chat`) с каналом из списка.
 * Сравнивает по username и числовому id против `username`/`chatId` канала (оба могут быть
 * заданы как "@name" или числом). Возвращает первое совпадение или `null`.
 */
export function matchChannelBySenderChat(
  senderChat: SenderChatRef | null | undefined,
  channels: RoutableChannel[],
): RoutableChannel | null {
  if (senderChat === null || senderChat === undefined) {
    return null;
  }
  const refs = new Set<string>();
  if (senderChat.username !== undefined && senderChat.username !== "") {
    refs.add(normalizeId(senderChat.username));
  }
  refs.add(String(senderChat.id));

  for (const channel of channels) {
    const keys: string[] = [];
    if (channel.username !== null) {
      keys.push(normalizeId(channel.username));
    }
    if (channel.chatId !== null) {
      keys.push(normalizeId(channel.chatId));
    }
    if (keys.some((k) => refs.has(k))) {
      return channel;
    }
  }
  return null;
}

/**
 * Выбирает канal коммента по приоритету: выученная связь (если канал ещё в списке
 * активных) → совпадение по `sender_chat` → первый канал списка → `null` (список пуст).
 */
export function resolveCommentChannel(
  learnedId: string | null,
  senderChatMatch: RoutableChannel | null,
  channels: RoutableChannel[],
): RoutableChannel | null {
  if (learnedId !== null) {
    const learned = channels.find((c) => c.id === learnedId);
    if (learned !== undefined) {
      return learned;
    }
  }
  if (senderChatMatch !== null) {
    return senderChatMatch;
  }
  return channels[0] ?? null;
}
