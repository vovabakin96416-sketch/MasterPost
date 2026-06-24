/**
 * «Здоровье» пула ответов — чтобы владелец видел в панели, что пул мал или
 * застоялся, и не забывал его освежить (иначе ответы приедаются аудитории).
 *
 * ЧИСТАЯ логика (без БД/Telegram): на вход число ответов и дата последнего
 * изменения пула (`TextPool.updatedAt`), на выход — флаг застоя и причина.
 */

/** Порог «мало ответов»: меньше — помечаем пул как требующий пополнения. */
export const MIN_ANSWERS = 4;

/** Порог «давно не обновляли», дней. */
export const STALE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PoolStaleReason = "few" | "old";

export interface PoolHealth {
  stale: boolean;
  reason: PoolStaleReason | null;
  /** Возраст пула в днях (для текста «обновлён N дн назад»); null, если даты нет. */
  ageDays: number | null;
}

/** Возраст пула в полных днях относительно `now` (null, если пула/даты нет). */
export function poolAgeDays(updatedAt: Date | null, now: Date): number | null {
  if (updatedAt === null) {
    return null;
  }
  return Math.floor((now.getTime() - updatedAt.getTime()) / DAY_MS);
}

/**
 * Считает пул «застоявшимся», если ответов меньше `MIN_ANSWERS` ИЛИ его не
 * меняли дольше `STALE_DAYS`. «Мало» приоритетнее «старого» в причине.
 */
export function poolHealth(
  count: number,
  updatedAt: Date | null,
  now: Date,
): PoolHealth {
  const ageDays = poolAgeDays(updatedAt, now);
  if (count < MIN_ANSWERS) {
    return { stale: true, reason: "few", ageDays };
  }
  if (ageDays !== null && ageDays > STALE_DAYS) {
    return { stale: true, reason: "old", ageDays };
  }
  return { stale: false, reason: null, ageDays };
}
