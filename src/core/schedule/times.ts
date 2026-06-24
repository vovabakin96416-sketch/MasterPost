import type { LocalDateParts } from "./localDate.js";

/**
 * Времена публикации канала — ЧИСТАЯ логика, под тестами.
 *
 * Доработка 4.1: вместо двух слотов «утро/вечер» админ задаёт ПРОИЗВОЛЬНЫЙ список
 * времён публикации на день. Планировщик тикает раз в минуту и спрашивает, какие
 * времена уже наступили и ещё не опубликованы сегодня. Условие «≥» даёт догон после
 * простоя; дедуп по локальной дате — чтобы каждое время сработало раз в день.
 */

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

/** Оставляет валидные времена, убирает дубли, сортирует по возрастанию. */
export function sortTimes(times: readonly string[]): string[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const t of times) {
    const minutes = parseTime(t);
    if (minutes === null || seen.has(t)) {
      continue;
    }
    seen.add(t);
    valid.push(t);
  }
  return valid.sort((a, b) => (parseTime(a) ?? 0) - (parseTime(b) ?? 0));
}

/** Прогресс публикаций за день: дата и уже отработанные сегодня времена. */
export interface Progress {
  readonly date: string | null; // локальная дата "YYYY-MM-DD" или null
  readonly postedTimes: readonly string[];
}

/**
 * Возвращает времена, которым «пора» в момент `today`: наступили (минуты ≤ сейчас)
 * и ещё не отработаны сегодня (с учётом сброса прогресса при смене даты). Результат
 * отсортирован по возрастанию.
 */
export function dueTimes(
  today: LocalDateParts,
  times: readonly string[],
  progress: Progress,
): string[] {
  const nowMinutes = today.hour * 60 + today.minute;
  const posted =
    progress.date === today.isoDate ? new Set(progress.postedTimes) : new Set<string>();
  return sortTimes(times).filter((t) => {
    const minutes = parseTime(t);
    return minutes !== null && minutes <= nowMinutes && !posted.has(t);
  });
}
