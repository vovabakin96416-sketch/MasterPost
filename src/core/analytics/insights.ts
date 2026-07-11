/**
 * Сборка выводов аналитики (Шаг 12a) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Верхний уровень ядра: из метрик постов собирает структурный `Insights` (лучший/худший
 * по вовлечённости, удачное время, тренд, выбросы). Только числа и факты — текст и
 * рекомендации строит слой отчёта (12c), голосовой AI-нарратив — 12d. Выбросы исключаем
 * из «лучший/худший» и из времени, но отдаём отдельным списком (в отчёте видно, что залёт
 * был виральный/рекламный, а не показатель контента).
 */

import { engagementRate } from "./engagement.js";
import { rankPostingTimes, type TimeSlotStat } from "./bestTime.js";
import { compareTrend, type TrendComparison } from "./trend.js";
import { flagViewOutliers } from "./outliers.js";
import type { PostMetricInput } from "./weeklyReport.js";

/** Пост вместе с посчитанным ERR (для «лучший/худший по вовлечённости»). */
export interface RankedPost {
  readonly post: PostMetricInput;
  readonly err: number;
}

/** Структурные выводы за период (факты, без форматирования). */
export interface Insights {
  readonly count: number;
  readonly best: RankedPost | null; // лучший по ERR среди не-выбросов
  readonly worst: RankedPost | null; // худший по ERR среди не-выбросов
  readonly bestTimes: readonly TimeSlotStat[]; // ячейки день×слот, лучшие первыми
  readonly trend: TrendComparison; // текущее окно против прошлого
  readonly outliers: readonly PostMetricInput[]; // помеченные выбросы по просмотрам
}

/**
 * Собирает выводы за текущее окно, сравнивая с прошлым. `tz` — пояс канала (для
 * группировки времени). Выбросы детектируются по просмотрам текущего окна и исключаются
 * из «лучший/худший» и из подбора времени.
 */
export function buildInsights(
  current: readonly PostMetricInput[],
  previous: readonly PostMetricInput[],
  tz: string,
): Insights {
  const outlierFlags = flagViewOutliers(current.map((m) => m.views));

  let best: RankedPost | null = null;
  let worst: RankedPost | null = null;
  const outliers: PostMetricInput[] = [];

  current.forEach((post, i) => {
    if (outlierFlags[i] === true) {
      outliers.push(post);
      return; // выброс не участвует в лучший/худший
    }
    const err = engagementRate(post);
    if (best === null || err > best.err) {
      best = { post, err };
    }
    if (worst === null || err < worst.err) {
      worst = { post, err };
    }
  });

  return {
    count: current.length,
    best,
    worst,
    bestTimes: rankPostingTimes(current, tz, outlierFlags),
    trend: compareTrend(current, previous),
    outliers,
  };
}
