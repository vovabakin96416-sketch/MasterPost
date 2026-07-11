/**
 * Эвристический советник (Шаг 12c) — ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Ядро 12a посчитало факты (`Insights`), 12b/12b-2 наполнили их данными и нативной
 * статой. Здесь превращаем факты в СТРУКТУРНЫЕ рекомендации (`Advice[]`) — всё ещё без
 * текста Telegram: только «что советуем» + приоритет. Русский текст рекомендаций строит
 * форматтер `insightsReport.ts`, голосовой AI-нарратив — 12d.
 *
 * Правила — на готовых `Insights` (12a) + контентных измерениях (`contentDimensionStats`)
 * + сводке снимка охвата (`SnapshotSummary`). Ничего не советуем на скудной выборке
 * (`MIN_POSTS_FOR_ADVICE`): один-два поста — это не сигнал.
 */

import type { Insights } from "./insights.js";
import type { ContentDimensionStats, LengthBucket, Slot } from "./dimensions.js";
import { MIDDAY_HOUR } from "./dimensions.js";
import type { TrendDirection } from "./trend.js";
import type { Weekday } from "../schedule/localDate.js";

/** Ниже этого числа постов в окне советов не даём — выборка не показательна. */
export const MIN_POSTS_FOR_ADVICE = 3;

/** Минимум постов в контентной группе, чтобы сравнивать её ERR (иначе шум). */
const MIN_POSTS_PER_DIMENSION = 2;

/** Сколько лучших нативных часов Telegram показываем/сравниваем. */
const NATIVE_HOURS_TOP = 3;

/**
 * Сводка снимка охвата в терминах ЯДРА (без типов БД). Сервис приводит нативные
 * лучшие часы Telegram к поясу канала (`nativeTopHoursLocal`, best-first) и достаёт
 * подписчиков текущего и прошлого снимков — чтобы советник остался чистым.
 */
export interface SnapshotSummary {
  readonly nativeTopHoursLocal: readonly number[];
  readonly subscribers: number | null;
  readonly previousSubscribers: number | null;
}

/**
 * Структурная рекомендация-факт (без текста). Дискриминант `kind` — что советуем;
 * `priority` — порядок показа (меньше = важнее/выше). Полезная нагрузка у каждого вида
 * своя; форматтер превращает её в русскую строку.
 */
export type Advice =
  | { readonly kind: "not_enough_data"; readonly priority: number; readonly count: number }
  | {
      readonly kind: "best_slot";
      readonly priority: number;
      readonly weekday: Weekday;
      readonly slot: Slot;
      readonly avgErr: number;
      readonly count: number;
    }
  | {
      readonly kind: "worst_slot";
      readonly priority: number;
      readonly weekday: Weekday;
      readonly slot: Slot;
      readonly avgErr: number;
    }
  | {
      readonly kind: "native_hours";
      readonly priority: number;
      readonly hours: readonly number[]; // локальные часы канала, best-first
      readonly matchesOwn: boolean; // совпал ли слот топ-часа с нашим лучшим слотом
    }
  | {
      readonly kind: "trend";
      readonly priority: number;
      readonly direction: TrendDirection; // по просмотрам
      readonly viewsDeltaPct: number | null;
      readonly subscribersDelta: number | null;
    }
  | {
      readonly kind: "content_media";
      readonly priority: number;
      readonly prefer: "with" | "without";
      readonly withErr: number;
      readonly withoutErr: number;
    }
  | {
      readonly kind: "content_buttons";
      readonly priority: number;
      readonly prefer: "with" | "without";
      readonly withErr: number;
      readonly withoutErr: number;
    }
  | {
      readonly kind: "content_length";
      readonly priority: number;
      readonly best: LengthBucket;
      readonly avgErr: number;
    }
  | { readonly kind: "outliers"; readonly priority: number; readonly count: number };

/** Слот по локальному часу канала (та же граница, что в `timeDimensions`). */
function slotOfHour(hour: number): Slot {
  return hour < MIDDAY_HOUR ? "morning" : "evening";
}

/**
 * Строит рекомендации из готовых выводов ядра, контентных измерений и сводки снимка.
 * Порядок: сначала «мало данных» (тогда только она), иначе — факты по убыванию
 * важности (время → нативные часы → тренд → формат → худший слот → выбросы).
 */
export function buildAdvice(
  insights: Insights,
  contentStats: ContentDimensionStats,
  snapshot: SnapshotSummary | null,
): Advice[] {
  if (insights.count < MIN_POSTS_FOR_ADVICE) {
    return [{ kind: "not_enough_data", priority: 0, count: insights.count }];
  }

  const advice: Advice[] = [];

  // Лучший/худший слот по ERR (ячейки день×слот уже отсортированы, лучшее — первым).
  const best = insights.bestTimes[0];
  if (best !== undefined) {
    advice.push({
      kind: "best_slot",
      priority: 1,
      weekday: best.weekday,
      slot: best.slot,
      avgErr: best.avgErr,
      count: best.count,
    });
  }
  if (insights.bestTimes.length >= 2) {
    const worst = insights.bestTimes[insights.bestTimes.length - 1];
    if (worst !== undefined) {
      advice.push({
        kind: "worst_slot",
        priority: 7,
        weekday: worst.weekday,
        slot: worst.slot,
        avgErr: worst.avgErr,
      });
    }
  }

  // Нативные лучшие часы Telegram — совпадают ли со «своим» лучшим слотом.
  const nativeHours = (snapshot?.nativeTopHoursLocal ?? []).slice(0, NATIVE_HOURS_TOP);
  if (nativeHours.length > 0) {
    const topHour = nativeHours[0];
    const matchesOwn =
      best !== undefined && topHour !== undefined && slotOfHour(topHour) === best.slot;
    advice.push({ kind: "native_hours", priority: 2, hours: nativeHours, matchesOwn });
  }

  // Тренд охвата: направление по просмотрам + Δ подписчиков между снимками.
  const subscribersDelta =
    snapshot !== null &&
    snapshot.subscribers !== null &&
    snapshot.previousSubscribers !== null
      ? snapshot.subscribers - snapshot.previousSubscribers
      : null;
  advice.push({
    kind: "trend",
    priority: 3,
    direction: insights.trend.viewsDirection,
    viewsDeltaPct: insights.trend.viewsDeltaPct,
    subscribersDelta,
  });

  // Контентные измерения: какой формат заходит (медиа / кнопки / длина).
  const media = compareTwo(contentStats.withMedia, contentStats.withoutMedia);
  if (media !== null) {
    advice.push({
      kind: "content_media",
      priority: 4,
      prefer: media,
      withErr: contentStats.withMedia.avgErr,
      withoutErr: contentStats.withoutMedia.avgErr,
    });
  }
  const buttons = compareTwo(contentStats.withButtons, contentStats.withoutButtons);
  if (buttons !== null) {
    advice.push({
      kind: "content_buttons",
      priority: 5,
      prefer: buttons,
      withErr: contentStats.withButtons.avgErr,
      withoutErr: contentStats.withoutButtons.avgErr,
    });
  }
  const bestLength = bestLengthBucket(contentStats);
  if (bestLength !== null) {
    advice.push({
      kind: "content_length",
      priority: 6,
      best: bestLength.bucket,
      avgErr: bestLength.avgErr,
    });
  }

  // Выбросы — отдельной пометкой (виральный/рекламный залёт, не показатель контента).
  if (insights.outliers.length > 0) {
    advice.push({ kind: "outliers", priority: 8, count: insights.outliers.length });
  }

  return advice.sort((a, b) => a.priority - b.priority);
}

/**
 * Что предпочесть из пары групп «с признаком / без» по среднему ERR. `null`, если в
 * какой-то группе слишком мало постов (сравнивать нечестно) или ERR практически равны.
 */
function compareTwo(
  withStat: { count: number; avgErr: number },
  withoutStat: { count: number; avgErr: number },
): "with" | "without" | null {
  if (
    withStat.count < MIN_POSTS_PER_DIMENSION ||
    withoutStat.count < MIN_POSTS_PER_DIMENSION ||
    withStat.avgErr === withoutStat.avgErr
  ) {
    return null;
  }
  return withStat.avgErr > withoutStat.avgErr ? "with" : "without";
}

/** Бакет длины с лучшим ERR среди бакетов с достаточной выборкой (или `null`). */
function bestLengthBucket(
  stats: ContentDimensionStats,
): { bucket: LengthBucket; avgErr: number } | null {
  const buckets: LengthBucket[] = ["short", "medium", "long"];
  let best: { bucket: LengthBucket; avgErr: number } | null = null;
  let eligible = 0;
  for (const bucket of buckets) {
    const stat = stats.length[bucket];
    if (stat.count < MIN_POSTS_PER_DIMENSION) {
      continue;
    }
    eligible += 1;
    if (best === null || stat.avgErr > best.avgErr) {
      best = { bucket, avgErr: stat.avgErr };
    }
  }
  // Один бакет не с чем сравнивать — «лучшего» формата по длине нет.
  return eligible >= 2 ? best : null;
}
