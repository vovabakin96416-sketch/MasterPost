import type { SubscriberPoint } from "./marketData.js";

/**
 * Детект аномалий ряда подписчиков (Шаг 12f) — ЧИСТАЯ логика (без HTTP/БД).
 *
 * Риск №5 («не учиться на мусоре») для внешнего ряда 12e-2: резкий суточный
 * скачок подписчиков — это накрутка или рекламный всплеск, а не органика.
 * Ядро только помечает такие дни; вывод владельцу — строка-предупреждение
 * в секции «🌍 Рынок» (`marketSection.ts`).
 */

/** Минимальный абсолютный суточный скачок, чтобы считаться аномалией. */
export const ANOMALY_MIN_ABS = 10;

/** Минимальная доля от базы (подписчиков накануне): 0.05 = 5%. */
export const ANOMALY_MIN_SHARE = 0.05;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Аномальный день: дата точки-скачка + суточная дельта со знаком. */
export interface SubscriberAnomaly {
  readonly date: string;
  readonly delta: number;
}

/** Разница дат `YYYY-MM-DD` в целых днях (обе трактуются как UTC-полночь). */
function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Ищет резкие СУТОЧНЫЕ скачки: |Δ| ≥ max(`ANOMALY_MIN_ABS`, `ANOMALY_MIN_SHARE` × база),
 * где база — подписчики в предыдущей точке. Порог двойной, потому что на малом канале
 * (база ~400, органика ±1-2/день) 5% — это уже 20 человек, а абсолютный минимум
 * отсекает шум на совсем крошечной базе. Дырки в ряду (соседние точки дальше суток)
 * пропускаем — размазанную по дням дельту нельзя выдавать за суточный скачок.
 * Точки сортируются здесь; пустой/одноточечный ряд → пусто.
 */
export function detectSubscriberAnomalies(
  points: readonly SubscriberPoint[],
): SubscriberAnomaly[] {
  const ascending = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const anomalies: SubscriberAnomaly[] = [];
  for (let i = 1; i < ascending.length; i += 1) {
    const prev = ascending[i - 1];
    const cur = ascending[i];
    if (prev === undefined || cur === undefined) {
      continue;
    }
    if (dayGap(prev.date, cur.date) !== 1) {
      continue;
    }
    const delta = cur.count - prev.count;
    const threshold = Math.max(ANOMALY_MIN_ABS, ANOMALY_MIN_SHARE * prev.count);
    if (Math.abs(delta) >= threshold) {
      anomalies.push({ date: cur.date, delta });
    }
  }
  return anomalies;
}
