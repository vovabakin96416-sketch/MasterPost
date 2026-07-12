/**
 * Назначение варианта посту (Шаг 13a) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Настоящего A/B в Telegram-канале нет: нельзя показать половине подписчиков вариант А.
 * Поэтому эксперимент ПОСЛЕДОВАТЕЛЬНЫЙ — варианты чередуются между постами. Ротация
 * детерминированная (по счётчику уже назначенных постов): варианты равномерно
 * перемешаны во времени, выборки честные (никакой вариант не «забирает» лучшие слоты).
 */

import type { ExperimentVariant } from "./experiment.js";

/**
 * Вариант для следующего поста эксперимента: `assignedCount` — сколько постов уже
 * получили вариант. Пустой список / кривой счётчик → null (эксперимент не назначает).
 */
export function assignVariant(
  variants: readonly ExperimentVariant[],
  assignedCount: number,
): ExperimentVariant | null {
  if (variants.length === 0 || assignedCount < 0 || !Number.isInteger(assignedCount)) {
    return null;
  }
  return variants[assignedCount % variants.length] ?? null;
}
