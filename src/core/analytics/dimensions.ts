/**
 * Измерения поста для аналитики (Шаг 12a) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Чтобы отвечать «когда публиковать» и «что заходит», группируем посты по измерениям.
 * Часть измерений выводится из САМОГО поста, без связи с планом (niche-agnostic и
 * работает даже для AI/разовых постов): день недели и слот утро/вечер по времени
 * публикации в поясе канала. Контентные признаки (медиа/кнопки/длина) приходят с данными
 * сбора 12b — для них тип оставляем расширяемым.
 */

import { localDateParts, type Weekday } from "../schedule/localDate.js";
import { engagementRate, type EngagementLike } from "./engagement.js";

/** Часть суток публикации. Порог — по местному часу канала. */
export type Slot = "morning" | "evening";

/**
 * Граница «утро/вечер» — местный час канала. До 15:00 считаем утренним слотом,
 * с 15:00 — вечерним. Совпадает с разнесением утренних (~10:00) и вечерних (~19:00+)
 * публикаций контент-плана; полдень-разделитель устойчив к сдвигам на пару часов.
 */
export const MIDDAY_HOUR = 15;

/** Временные измерения поста — выводятся из момента публикации и пояса канала. */
export interface TimeDimensions {
  readonly hour: number; // 0..23 в поясе канала
  readonly weekday: Weekday;
  readonly slot: Slot;
}

/** Считает временные измерения поста в поясе канала. */
export function timeDimensions(postedAt: Date, timeZone: string): TimeDimensions {
  const parts = localDateParts(postedAt, timeZone);
  return {
    hour: parts.hour,
    weekday: parts.weekday,
    slot: parts.hour < MIDDAY_HOUR ? "morning" : "evening",
  };
}

// ── Контентные измерения «что заходит» (Шаг 12c) ────────────────────────────
//
// Советнику (advisor.ts) нужно сравнить средний ERR постов с медиа/без, с
// кнопками/без и по длине текста, чтобы подсказать формат. Считаем это здесь —
// рядом с временными измерениями, но по контентным полям поста (12b). Тоже
// ЧИСТАЯ логика: на вход минимальный структурный тип, наружу — только числа.

/** Пост с контентными полями (12b) + вовлечённостью — вход для группировки. */
export interface ContentDimensioned extends EngagementLike {
  readonly hasMedia: boolean;
  readonly hasButtons: boolean;
  readonly charLen: number;
}

/** Бакет длины текста поста: короткий / средний / длинный. */
export type LengthBucket = "short" | "medium" | "long";

/** Границы длины (символов): до 200 — короткий, 200..600 — средний, дальше длинный. */
export const CHAR_LEN_SHORT_MAX = 200;
export const CHAR_LEN_LONG_MIN = 600;

/** Относит длину текста к бакету. */
export function lengthBucket(charLen: number): LengthBucket {
  if (charLen < CHAR_LEN_SHORT_MAX) {
    return "short";
  }
  return charLen < CHAR_LEN_LONG_MIN ? "medium" : "long";
}

/** Среднее ERR по группе постов (пусто → нули). */
export interface DimensionStat {
  readonly count: number;
  readonly avgErr: number;
}

/** Средний ERR и число постов по каждому контентному измерению. */
export interface ContentDimensionStats {
  readonly withMedia: DimensionStat;
  readonly withoutMedia: DimensionStat;
  readonly withButtons: DimensionStat;
  readonly withoutButtons: DimensionStat;
  readonly length: Readonly<Record<LengthBucket, DimensionStat>>;
}

/** Средний ERR по списку постов (пустой список → {count:0, avgErr:0}). */
function statOf(posts: readonly EngagementLike[]): DimensionStat {
  if (posts.length === 0) {
    return { count: 0, avgErr: 0 };
  }
  const sum = posts.reduce((s, p) => s + engagementRate(p), 0);
  return { count: posts.length, avgErr: sum / posts.length };
}

/**
 * Группирует посты по контентным измерениям и считает средний ERR в каждой группе.
 * Никаких выводов — только числа; какое измерение «выиграло» и стоит ли доверять
 * (порог по числу постов) решает советник (advisor.ts).
 */
export function contentDimensionStats(
  posts: readonly ContentDimensioned[],
): ContentDimensionStats {
  const byLength = (bucket: LengthBucket): DimensionStat =>
    statOf(posts.filter((p) => lengthBucket(p.charLen) === bucket));
  return {
    withMedia: statOf(posts.filter((p) => p.hasMedia)),
    withoutMedia: statOf(posts.filter((p) => !p.hasMedia)),
    withButtons: statOf(posts.filter((p) => p.hasButtons)),
    withoutButtons: statOf(posts.filter((p) => !p.hasButtons)),
    length: {
      short: byLength("short"),
      medium: byLength("medium"),
      long: byLength("long"),
    },
  };
}
