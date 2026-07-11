/**
 * Фильтр качества данных (Шаг 12a, риск №5) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Виральный репост или рекламный залёт даёт посту всплеск просмотров, не связанный с
 * качеством контента. Если учить выводы «что заходит» на таких выбросах — учимся на
 * мусоре. Поэтому выбросы по просмотрам помечаем и исключаем из агрегатов (лучшее время,
 * тренд), но не удаляем — в отчёте их видно отдельно.
 *
 * Метод устойчив к малой выборке: сравниваем с МЕДИАНОЙ (а не средним — среднее сам
 * выброс и тащит вверх). Пост — выброс, если просмотров ≥ `factor` × медианы.
 */

/** Во сколько раз выше медианы просмотры считаем выбросом (виральный/рекламный залёт). */
export const DEFAULT_OUTLIER_FACTOR = 3;

/** Минимум постов, ниже которого детект выбросов не запускаем (мало данных — нет медианы). */
export const MIN_SAMPLE_FOR_OUTLIERS = 4;

/** Медиана списка чисел (для чётной длины — среднее двух центральных). Пусто → 0. */
export function median(nums: readonly number[]): number {
  if (nums.length === 0) {
    return 0;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Помечает выбросы по просмотрам. Возвращает массив булей ПО ПОРЯДКУ входа (i-й пост —
 * выброс?). При выборке меньше `MIN_SAMPLE_FOR_OUTLIERS` или нулевой медиане — всё `false`
 * (не на чем строить порог, честнее ничего не отсекать).
 */
export function flagViewOutliers(
  views: readonly number[],
  factor: number = DEFAULT_OUTLIER_FACTOR,
): boolean[] {
  if (views.length < MIN_SAMPLE_FOR_OUTLIERS) {
    return views.map(() => false);
  }
  const med = median(views);
  if (med <= 0) {
    return views.map(() => false);
  }
  const threshold = med * factor;
  return views.map((v) => v >= threshold);
}
