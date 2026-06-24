/**
 * Локальная дата/время канала по его часовому поясу — ЧИСТАЯ логика (без БД/Telegram).
 *
 * Автопостинг рассуждает в терминах «какой сейчас день и час В КАНАЛЕ» (напр.
 * Europe/Moscow), а не в UTC сервера. Извлечение делаем через `Intl.DateTimeFormat`:
 * оно детерминированно для пары (instant, timeZone), поэтому функция тестируема —
 * передаём фиксированный `now` и пояс, получаем стабильный результат.
 */

/** Дни недели в порядке нашей схемы (Prisma `Weekday`), Monday=0 как в Python. */
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Разобранные локальные части даты/времени канала. */
export interface LocalDateParts {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly weekday: Weekday;
  readonly isoDate: string; // "YYYY-MM-DD" (локальная календарная дата канала)
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/**
 * Возвращает локальные части даты/времени для момента `now` в поясе `timeZone`.
 * `weekday` считаем из календарной даты (Date.UTC + getUTCDay), а не из Intl —
 * так не зависим от локали форматтера.
 */
export function localDateParts(now: Date, timeZone: string): LocalDateParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map = new Map<string, string>(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const num = (type: string): number => Number(map.get(type) ?? "0");

  const year = num("year");
  const month = num("month");
  const day = num("day");
  const minute = num("minute");
  // Некоторые рантаймы отдают "24" для полуночи при hour12:false — нормализуем.
  const hourRaw = num("hour");
  const hour = hourRaw === 24 ? 0 : hourRaw;

  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const weekday = WEEKDAYS[(jsDay + 6) % 7] ?? "monday"; // индекс всегда 0..6

  return {
    year,
    month,
    day,
    weekday,
    isoDate: `${String(year)}-${pad2(month)}-${pad2(day)}`,
    hour,
    minute,
  };
}
