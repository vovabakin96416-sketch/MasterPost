import type { LocalDateParts } from "./localDate.js";

/**
 * «Какие слоты пора публиковать прямо сейчас» — ЧИСТАЯ логика, под тестами.
 *
 * Планировщик тикает раз в минуту и спрашивает эту функцию. Слот «пора», если
 * локальное время канала уже достигло времени слота И этот слот ещё не публиковался
 * сегодня (дедуп по локальной дате). Условие «≥», а не «==», даёт догон после
 * простоя бота (аналог `misfire_grace_time` в Python-боте).
 */

export type SlotName = "morning" | "evening";

/** Времена публикации слотов в формате "HH:MM" (из настроек канала). */
export interface ScheduleTimes {
  readonly morning: string;
  readonly evening: string;
}

/** Локальная дата последней публикации каждого слота ("YYYY-MM-DD" или null). */
export interface LastPosted {
  readonly morning: string | null;
  readonly evening: string | null;
}

/** Парсит "HH:MM" в минуты от полуночи; кривой ввод → null. */
export function parseTime(input: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(input.trim());
  if (m === null) {
    return null;
  }
  const hh = m[1];
  const mm = m[2];
  if (hh === undefined || mm === undefined) {
    return null;
  }
  return Number(hh) * 60 + Number(mm);
}

/**
 * Возвращает слоты, которые пора опубликовать в момент `today`.
 * Слот с невалидным временем тихо пропускается (не «пора»).
 */
export function dueSlots(
  today: LocalDateParts,
  schedule: ScheduleTimes,
  last: LastPosted,
): SlotName[] {
  const nowMinutes = today.hour * 60 + today.minute;
  const result: SlotName[] = [];

  const consider = (
    slot: SlotName,
    timeStr: string,
    lastDate: string | null,
  ): void => {
    const slotMinutes = parseTime(timeStr);
    if (slotMinutes === null) {
      return;
    }
    if (nowMinutes >= slotMinutes && lastDate !== today.isoDate) {
      result.push(slot);
    }
  };

  consider("morning", schedule.morning, last.morning);
  consider("evening", schedule.evening, last.evening);
  return result;
}
