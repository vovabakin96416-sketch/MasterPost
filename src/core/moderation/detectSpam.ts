import { containsTrigger } from "../triggers/containsTrigger.js";

/**
 * Дешёвая эвристическая детекция спама в комментах (Шаг 11d).
 *
 * ЧИСТАЯ логика (без Telegram/БД/сети/AI) — на вход текст + контекст, на выход
 * вердикт. НЕ тратит токены: только регэкспы и сравнение со списком стоп-слов.
 * Стоит первой в конвейере комментов, чтобы отсекать мусор до триггеров и AI.
 *
 * Тематики в коде нет: стоп-слова приходят из настроек канала. Привилегированный
 * отправитель (админ канала / сам канал через автопересылку) НЕ модерируется —
 * решение об этом принимает стадия, сюда приходит уже готовый `isPrivileged`.
 *
 * Категория `borderline` — хук под Шаг 11e (токсичность через Haiku): дешёвые
 * эвристики её не выдают, но тип объявлен, чтобы будущий AI-слой встроился без
 * ломки контракта.
 */

/** Причина, по которой коммент помечен спамом (порядок = приоритет проверки). */
export type SpamReason = "link" | "mentions" | "repeat" | "stopword";

/**
 * Категория коммента. `clean`/`spam` даёт этот модуль; `borderline` —
 * зарезервировано под токсичность (Шаг 11e), сейчас не возвращается.
 */
export type SpamCategory = "clean" | "spam" | "borderline";

/** Вход детектора: сам текст + контекст. */
export interface SpamInput {
  readonly text: string;
  /** Привилегированный отправитель (админ/канал) — не модерируем. */
  readonly isPrivileged: boolean;
  /** Стоп-слова канала (уже из настроек). Пусто → эвристика стоп-слов молчит. */
  readonly stopWords?: readonly string[];
}

/** Вердикт детектора (дискриминированный результат в стиле ядра). */
export type SpamVerdict =
  | { readonly spam: false }
  | { readonly spam: true; readonly reason: SpamReason };

/** Порог числа @-упоминаний, при котором коммент считаем флудом-упоминаниями. */
export const MENTION_THRESHOLD = 3;

/** Порог длины серии одинаковых подряд идущих символов (`аааа`, `!!!!`). */
export const REPEAT_RUN_THRESHOLD = 4;

const NOT_SPAM: SpamVerdict = { spam: false };

// Явные ссылки: http(s):// или www. — далее любой не-пробельный «хвост».
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
// Телеграм-ссылки/инвайты: t.me/xxx.
const TME_RE = /\bt\.me\/\S+/i;
// Голый домен вида slovo.tld по частым «спамным» зонам (казино/крипта/магазины).
const BARE_DOMAIN_RE =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:ru|com|net|org|io|me|xyz|info|top|club|site|online|shop|store|link|cc|biz|app|pro)\b/i;
// @-упоминание: собака + минимум 3 буквенно-цифровых символа.
const MENTION_RE = /@[A-Za-z0-9_]{3,}/g;
// Серия одинаковых символов длиной REPEAT_RUN_THRESHOLD и более.
const REPEAT_RE = new RegExp(`(.)\\1{${REPEAT_RUN_THRESHOLD - 1},}`, "u");

/** Есть ли в тексте ссылка/домен/t.me. */
function hasLink(text: string): boolean {
  return URL_RE.test(text) || TME_RE.test(text) || BARE_DOMAIN_RE.test(text);
}

/** Число @-упоминаний в тексте. */
function countMentions(text: string): number {
  return text.match(MENTION_RE)?.length ?? 0;
}

/**
 * Оценивает коммент дешёвыми эвристиками. Привилегированный отправитель всегда
 * `{ spam: false }`. Проверки идут по приоритету: ссылки → флуд упоминаний →
 * растянутые повторы → стоп-слово.
 */
export function detectSpam(input: SpamInput): SpamVerdict {
  if (input.isPrivileged) {
    return NOT_SPAM;
  }
  const { text } = input;

  if (hasLink(text)) {
    return { spam: true, reason: "link" };
  }
  if (countMentions(text) >= MENTION_THRESHOLD) {
    return { spam: true, reason: "mentions" };
  }
  // Повторы считаем по СЫРОМУ тексту: нормализация ядра их схлопывает.
  if (REPEAT_RE.test(text)) {
    return { spam: true, reason: "repeat" };
  }
  const stopWords = input.stopWords ?? [];
  if (stopWords.length > 0 && containsTrigger(text, stopWords) !== null) {
    return { spam: true, reason: "stopword" };
  }
  return NOT_SPAM;
}
