/**
 * Подбор удачного времени публикации (Шаг 12a) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Группируем посты по (день недели × слот утро/вечер) и считаем средний ERR в каждой
 * ячейке. При 400 подписчиках и нескольких постах в неделю почасовая нарезка слишком
 * дробная (по одному посту в бакете — шум), поэтому берём слот как устойчивую
 * гранулярность. Позже (12b) сверим с нативным графиком лучших часов Telegram.
 */

import { engagementRate, type EngagementLike } from "./engagement.js";
import { timeDimensions, type Slot } from "./dimensions.js";
import type { Weekday } from "../schedule/localDate.js";

/** Пост для анализа времени: момент публикации + поля вовлечённости. */
export interface TimedPost extends EngagementLike {
  readonly postedAt: Date;
}

/** Средняя вовлечённость по ячейке «день недели × слот». */
export interface TimeSlotStat {
  readonly weekday: Weekday;
  readonly slot: Slot;
  readonly count: number;
  readonly avgErr: number;
}

/**
 * Считает средний ERR по каждой непустой ячейке (день × слот) и возвращает их
 * отсортированными по убыванию ERR (лучшее время — первым). Пустой вход → пустой список.
 * `outlier[i]` (если передан) исключает i-й пост из статистики (виральные/рекламные —
 * не показатель удачного времени, см. `outliers.ts`).
 */
export function rankPostingTimes(
  posts: readonly TimedPost[],
  timeZone: string,
  outlier?: readonly boolean[],
): TimeSlotStat[] {
  const buckets = new Map<string, { weekday: Weekday; slot: Slot; sum: number; count: number }>();

  posts.forEach((post, i) => {
    if (outlier?.[i] === true) {
      return;
    }
    const { weekday, slot } = timeDimensions(post.postedAt, timeZone);
    const key = `${weekday}|${slot}`;
    const bucket = buckets.get(key) ?? { weekday, slot, sum: 0, count: 0 };
    bucket.sum += engagementRate(post);
    bucket.count += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.values()]
    .map((b) => ({
      weekday: b.weekday,
      slot: b.slot,
      count: b.count,
      avgErr: b.sum / b.count,
    }))
    .sort((a, b) => b.avgErr - a.avgErr);
}
