/**
 * Тренд период-к-периоду (Шаг 12a) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * «Охват растёт или падает?» — сравнение агрегатов текущего окна (напр. эта неделя) с
 * прошлым. Считаем средние по постам, чтобы разное число постов в окнах не искажало
 * (7 постов vs 4 — сравнение по среднему честнее суммы). Направление — с зоной
 * стабильности: мелкие колебания не выдаём за «рост/падение».
 */

import { engagementRate, type EngagementLike } from "./engagement.js";

/** Пост для тренда: просмотры + поля вовлечённости. */
export type TrendPost = EngagementLike;

/** Агрегат одного окна. */
export interface PeriodStat {
  readonly count: number;
  readonly avgViews: number;
  readonly avgErr: number;
}

/** Направление изменения с зоной стабильности вокруг нуля. */
export type TrendDirection = "up" | "down" | "flat";

/** Сравнение двух окон по просмотрам и вовлечённости. */
export interface TrendComparison {
  readonly current: PeriodStat;
  readonly previous: PeriodStat;
  readonly viewsDeltaPct: number | null; // null — прошлое окно пустое, базы для % нет
  readonly errDeltaPct: number | null;
  readonly viewsDirection: TrendDirection;
  readonly errDirection: TrendDirection;
}

/** Порог зоны стабильности: изменение по модулю меньше — считаем «без изменений». */
export const FLAT_THRESHOLD_PCT = 5;

/** Считает агрегат окна: число постов и средние просмотры/ERR. Пусто → нули. */
export function periodStat(posts: readonly TrendPost[]): PeriodStat {
  if (posts.length === 0) {
    return { count: 0, avgViews: 0, avgErr: 0 };
  }
  let views = 0;
  let err = 0;
  for (const p of posts) {
    views += p.views;
    err += engagementRate(p);
  }
  return {
    count: posts.length,
    avgViews: views / posts.length,
    avgErr: err / posts.length,
  };
}

/** Процент изменения от базы; база 0 → null (делить не на что). */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

/** Направление по проценту: за зоной стабильности — рост/падение, иначе flat. */
function direction(pct: number | null): TrendDirection {
  if (pct === null || Math.abs(pct) < FLAT_THRESHOLD_PCT) {
    return "flat";
  }
  return pct > 0 ? "up" : "down";
}

/** Сравнивает текущее окно с прошлым по просмотрам и ERR. */
export function compareTrend(
  current: readonly TrendPost[],
  previous: readonly TrendPost[],
): TrendComparison {
  const cur = periodStat(current);
  const prev = periodStat(previous);
  const viewsDeltaPct = deltaPct(cur.avgViews, prev.avgViews);
  const errDeltaPct = deltaPct(cur.avgErr, prev.avgErr);
  return {
    current: cur,
    previous: prev,
    viewsDeltaPct,
    errDeltaPct,
    viewsDirection: direction(viewsDeltaPct),
    errDirection: direction(errDeltaPct),
  };
}
