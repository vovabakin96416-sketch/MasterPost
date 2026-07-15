/**
 * Ссылка на сообщение в Telegram — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Отчёт по просмотрам называл пост обрезанным превью текста, и открыть его было нельзя.
 * `messageId` есть в каждой метрике, `username`/`chatId` — у канала, так что ссылка
 * собирается без новых запросов и миграций.
 *
 * Единственное место, где живёт правило `-100…` → `t.me/c/…`: раньше оно дублировалось
 * в модерации комментариев (`buildCommentLink`), теперь та зовёт эту функцию.
 */

/** Канал в объёме построения ссылки: публичный `username` либо числовой `chatId`. */
export interface PostLinkRef {
  readonly username: string | null;
  readonly chatId: string | null;
}

/** Префикс числовых id супергрупп/каналов; в ссылке `t.me/c/…` его отбрасывают. */
const SUPERGROUP_PREFIX = "-100";

/**
 * Строит публичную ссылку на сообщение: `t.me/<username>/<id>` для канала с юзернеймом,
 * иначе `t.me/c/<id без -100>/<id>` для приватного. `null` — ссылку не построить
 * (нет ни юзернейма, ни числового id вида `-100…`; например, chatId задан как `@name`
 * или канал приватный со старым id).
 */
export function buildPostLink(ref: PostLinkRef, messageId: number): string | null {
  const chatId = ref.chatId?.trim() ?? "";
  // `chatId` бывает и `@username` (см. схему `Channel.chatId`) — тогда он равноценен
  // полю `username`, поэтому оба кандидата чистим одним правилом.
  const handle = pickHandle(ref.username, chatId);
  if (handle !== "") {
    return `https://t.me/${handle}/${String(messageId)}`;
  }
  if (!chatId.startsWith(SUPERGROUP_PREFIX)) {
    return null;
  }
  return `https://t.me/c/${chatId.slice(SUPERGROUP_PREFIX.length)}/${String(messageId)}`;
}

/** Первый непустой юзернейм из кандидатов, без ведущей `@`; `""` — юзернейма нет. */
function pickHandle(...candidates: readonly (string | null)[]): string {
  for (const candidate of candidates) {
    const handle = candidate?.trim().replace(/^@/, "").trim() ?? "";
    // Числовой id (`-100…`) юзернеймом не является — его обрабатывает ветка `t.me/c/`.
    if (handle !== "" && !/^-?\d+$/.test(handle)) {
      return handle;
    }
  }
  return "";
}
