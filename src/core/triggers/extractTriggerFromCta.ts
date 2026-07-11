import { normalizeTriggerText } from "./matchTrigger.js";

/**
 * Извлечение призывного слова из CTA поста (Шаг 11f).
 *
 * ЧИСТАЯ логика без БД/сети/токенов: на вход — текст призыва (`Post.cta`), на
 * выход — слово-кандидат в AI-триггеры (Шаг 11c) или `null`. Идея: владелец
 * публикует «напишите СЛОВО в комментах» → бот САМ регистрирует это слово, и
 * стадия `aiReplyStage` отвечает голосом канала, без ручной сверки триггеров.
 *
 * Эвристика (0 токенов), по приоритету:
 *  1. слово/короткая фраза в кавычках («…» / "…" / „…“) — явный, намеренный маркер;
 *  2. слово КАПСОМ (≥3 буквы, целиком в верхнем регистре) — «напишите СЛОВО».
 * Кавычки в приоритете: это более однозначный указатель, чем КАПС (последний
 * может случайно поймать аббревиатуру). Ничего не подошло → `null` (молча).
 *
 * Возвращаем ИСХОДНУЮ форму кандидата (обрезанную), как `validateTriggerWord`:
 * матчинг триггеров всё равно нормализует обе стороны (`normalizeTriggerText`).
 */

/** Минимальная длина кандидата после нормализации (отсекаем «да»/«ok»/эмодзи). */
export const MIN_CTA_TRIGGER_LEN = 3;

/** Максимальная длина кандидата после нормализации (слово/короткая фраза, не текст). */
export const MAX_CTA_TRIGGER_LEN = 40;

/** Максимум слов в кандидате — призывное слово или короткая фраза («карта дня»). */
const MAX_CTA_TRIGGER_WORDS = 3;

/** Кавычки-ограничители (типографские и прямые), из которых берём содержимое. */
const QUOTED_RE = /[«"„“”]\s*([^«»"„“”]{1,60}?)\s*[»"„“”]/u;

/** Проверяет кандидата по нормализованной длине и числу слов. */
function isValidCandidate(candidate: string): boolean {
  const normalized = normalizeTriggerText(candidate);
  if (
    normalized.length < MIN_CTA_TRIGGER_LEN ||
    normalized.length > MAX_CTA_TRIGGER_LEN
  ) {
    return false;
  }
  return normalized.split(" ").length <= MAX_CTA_TRIGGER_WORDS;
}

/**
 * Достаёт слово-триггер из CTA поста или `null`. См. описание модуля.
 */
export function extractTriggerFromCta(cta: string): string | null {
  // 1) Слово/фраза в кавычках — владелец выделил её намеренно.
  const quoted = QUOTED_RE.exec(cta);
  if (quoted?.[1] !== undefined) {
    const candidate = quoted[1].trim();
    if (isValidCandidate(candidate)) {
      return candidate;
    }
  }
  // 2) Слово КАПСОМ: токен целиком в верхнем регистре и с хотя бы одной буквой.
  for (const token of cta.split(/[^\p{L}\p{N}]+/u)) {
    if (
      /\p{L}/u.test(token) &&
      token === token.toUpperCase() &&
      token !== token.toLowerCase() &&
      isValidCandidate(token)
    ) {
      return token;
    }
  }
  return null;
}
