/**
 * Валидация пользовательского ввода в меню админа (новый ответ / новое слово).
 *
 * ЧИСТАЯ логика (без grammY/БД): возвращаем дискриминированный результат
 * `ok | error`, чтобы Telegram-слой просто показал текст ошибки или применил
 * нормализованное значение. Тематики нет — правила общие для любого канала.
 */

import { normalizeTriggerText } from "../triggers/matchTrigger.js";

/** Максимальная длина ответа-предсказания (запас под лимит сообщения Telegram). */
export const MAX_ANSWER_LENGTH = 3500;

export type ValidationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

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
