import type { SubscriberPoint } from "./marketData.js";

/**
 * Динамика подписчиков (Шаг 12e-2) — ЧИСТАЯ логика (без HTTP/БД).
 *
 * Превращает ряд точек `/channels/subscribers` (по дням, возможно с дырками и
 * в любом порядке) в ответ на вопрос владельца «канал растёт или сохнет
 * снаружи?»: текущее число + Δ за 7 и за 28 дней.
 */

/** Окно запроса ряда: ровно месяц Telemetr отклоняет (HTTP 400), 28 дней — ок. */
export const SUBSCRIBER_WINDOW_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Выводы из ряда: Δ = текущее − значение на границе окна (нет базы → null). */
export interface SubscriberDynamics {
  /** Подписчиков на последнюю точку ряда. */
  readonly current: number;
  readonly delta7d: number | null;
  readonly delta28d: number | null;
}

/** Дата `YYYY-MM-DD` (UTC) на `days` дней раньше `now`. */
function cutoffDate(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * База для Δ: ПОСЛЕДНЯЯ точка не моложе границы окна (ряд с дырками — берём
 * ближайшую до неё). Ряд начинается после границы → базы нет → `null`
 * (история короче окна — честнее промолчать, чем занизить дельту).
 */
function baselineCount(
  ascending: readonly SubscriberPoint[],
  cutoff: string,
): number | null {
  let found: number | null = null;
  for (const point of ascending) {
    if (point.date > cutoff) {
      break;
    }
    found = point.count;
  }
  return found;
}

/**
 * Считает динамику по ряду точек. Пустой ряд → `null` (строки динамики нет).
 * Точки сортируются здесь — порядок ответа API ядро не волнует.
 */
export function computeSubscriberDynamics(
  points: readonly SubscriberPoint[],
  now: Date,
): SubscriberDynamics | null {
  if (points.length === 0) {
    return null;
  }
  const ascending = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = ascending[ascending.length - 1];
  if (last === undefined) {
    return null;
  }
  const base7 = baselineCount(ascending, cutoffDate(now, 7));
  const base28 = baselineCount(ascending, cutoffDate(now, SUBSCRIBER_WINDOW_DAYS));
  return {
    current: last.count,
    delta7d: base7 === null ? null : last.count - base7,
    delta28d: base28 === null ? null : last.count - base28,
  };
}
