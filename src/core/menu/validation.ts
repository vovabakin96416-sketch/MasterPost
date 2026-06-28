/**
 * Валидация пользовательского ввода в меню админа (новый ответ / новое слово).
 *
 * ЧИСТАЯ логика (без grammY/БД): возвращаем дискриминированный результат
 * `ok | error`, чтобы Telegram-слой просто показал текст ошибки или применил
 * нормализованное значение. Тематики нет — правила общие для любого канала.
 */

import { normalizeTriggerText } from "../triggers/matchTrigger.js";
import { parseTime } from "../schedule/times.js";

/** Максимальная длина ответа-предсказания (запас под лимит сообщения Telegram). */
export const MAX_ANSWER_LENGTH = 3500;

export type ValidationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/** Результат валидации числового ввода (кулдаун) — несёт число, а не строку. */
export type NumberValidationResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

/** Максимальный кулдаун триггеров в часах (неделя — разумный потолок). */
export const MAX_COOLDOWN_HOURS = 168;

/**
 * Проверяет ввод кулдауна триггеров: целое число часов, 0…168.
 * `0` разрешён и означает «кулдаун выключен» (триггер без задержки).
 */
export function validateCooldownHours(input: string): NumberValidationResult {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      error: "Нужно целое число часов, например 24 (или 0, чтобы отключить).",
    };
  }
  const hours = Number(trimmed);
  if (hours > MAX_COOLDOWN_HOURS) {
    return {
      ok: false,
      error: `Слишком много — максимум ${String(MAX_COOLDOWN_HOURS)} ч (неделя).`,
    };
  }
  return { ok: true, value: hours };
}

/**
 * Проверяет текст нового/изменённого ответа: непустой и в пределах лимита.
 * Возвращает обрезанное по краям значение (как сохраним в пул).
 */
export function validateAnswer(input: string): ValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Пустой текст — пришлите непустой ответ." };
  }
  if (trimmed.length > MAX_ANSWER_LENGTH) {
    return {
      ok: false,
      error: `Слишком длинно (${String(trimmed.length)} символов, лимит ${String(MAX_ANSWER_LENGTH)}).`,
    };
  }
  return { ok: true, value: trimmed };
}

/** Лимиты длины полей поста контент-плана (Шаг 6.5). */
export const POST_FIELD_LIMITS = {
  title: 200,
  cta: 300,
  text: MAX_ANSWER_LENGTH,
} as const;

/** Поле поста, редактируемое из меню (Шаг 6.5). */
export type PostField = keyof typeof POST_FIELD_LIMITS;

/** Подпись поля для текста ошибки/приглашения. */
const POST_FIELD_LABEL: Record<PostField, string> = {
  title: "заголовок",
  cta: "призыв",
  text: "текст",
};

/**
 * Проверяет новый текст поля поста (Шаг 6.5): непустой и в пределах лимита поля.
 * Возвращает обрезанное по краям значение. ЧИСТАЯ логика — лимиты общие для любого канала.
 */
export function validatePostField(input: string, field: PostField): ValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: `Пустой ${POST_FIELD_LABEL[field]} — пришлите непустой текст.`,
    };
  }
  const limit = POST_FIELD_LIMITS[field];
  if (trimmed.length > limit) {
    return {
      ok: false,
      error: `Слишком длинно (${String(trimmed.length)} символов, лимит ${String(limit)}).`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Проверяет новое слово-триггер: непустое после нормализации и не дублирует уже
 * существующее (сравнение через `normalizeTriggerText`, как в матчинге Шага 2).
 * Сохраняем введённую форму (обрезанную) — матчинг всё равно нормализует обе стороны.
 */
export function validateTriggerWord(
  input: string,
  existingWords: readonly string[],
): ValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Пустое слово — пришлите слово-триггер." };
  }
  const normalized = normalizeTriggerText(trimmed);
  if (normalized === "") {
    return {
      ok: false,
      error: "Слово состоит только из знаков или пробелов — пришлите буквы/цифры.",
    };
  }
  for (const word of existingWords) {
    if (normalizeTriggerText(word) === normalized) {
      return { ok: false, error: `Такой триггер уже есть: «${word}».` };
    }
  }
  return { ok: true, value: trimmed };
}

/**
 * Проверяет ввод времени публикации (Шаг 4): формат "HH:MM", 00:00–23:59.
 * Возвращает нормализованную форму с ведущим нулём ("9:5" → "09:05").
 */
export function validateTime(input: string): ValidationResult {
  const minutes = parseTime(input);
  if (minutes === null) {
    return {
      ok: false,
      error: "Неверное время. Пришлите в формате ЧЧ:ММ, например 10:00.",
    };
  }
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return { ok: true, value: `${pad(hh)}:${pad(mm)}` };
}

/**
 * Проверяет адрес канала публикации (Доработка 4.1): принимает `@username`,
 * ссылку `t.me/...`, голый `username` или числовой id канала (`-100…`).
 * Возвращает нормализованную форму: `@username` либо строку-id.
 */
export function validateChannelTarget(input: string): ValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Пусто — пришлите @username, ссылку t.me/… или id канала." };
  }
  // Числовой id канала (обычно -100…) — принимаем как есть.
  if (/^-?\d{5,}$/.test(trimmed)) {
    return { ok: true, value: trimmed };
  }
  // Ссылка t.me/<name> или https://t.me/<name> (+ возможный хвост).
  const link = /(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})/i.exec(trimmed);
  if (link?.[1] !== undefined) {
    return { ok: true, value: `@${link[1]}` };
  }
  // @username или голый username (буква, затем буквы/цифры/_, 4–32 символа).
  const name = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)) {
    return { ok: true, value: `@${name}` };
  }
  return {
    ok: false,
    error:
      "Не похоже на канал. Пришлите @username (например, @supertestmaster), " +
      "ссылку t.me/… или числовой id.",
  };
}
