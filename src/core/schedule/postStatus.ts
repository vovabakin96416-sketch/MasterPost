import { WEEKDAYS, type LocalDateParts, type Weekday } from "./localDate.js";
import { parseTime } from "./times.js";

/**
 * Статус поста недели относительно «сейчас» — ЧИСТАЯ логика, под тестами.
 *
 * Нужен для экрана «📅 Календарь»: показать, какие посты текущей недели уже прошли,
 * какие сегодня впереди, а какие — в следующие дни. Считаем ТОЛЬКО по расписанию
 * (день недели + время), без обращения к БД/публикациям, поэтому функция тестируема.
 *
 * - `passed`   — день раньше сегодня, ЛИБО сегодня и время уже наступило (мин. ≤ сейчас);
 * - `today`    — сегодня и время ещё впереди (мин. > сейчас);
 * - `upcoming` — день позже сегодня в этой неделе.
 */
export type PostStatus = "passed" | "today" | "upcoming";

/** Порядковый индекс дня недели (monday=0 … sunday=6), как в схеме Prisma. */
export function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

/**
 * @param today локальные части «сегодня» в поясе канала (см. localDate.ts)
 * @param day   день недели поста
 * @param time  время поста "HH:MM" (кривое → трактуем как «ещё впереди» в свой день)
 */
export function postStatus(
  today: LocalDateParts,
  day: Weekday,
  time: string,
): PostStatus {
  const todayIdx = weekdayIndex(today.weekday);
  const dayIdx = weekdayIndex(day);
  if (dayIdx < todayIdx) {
    return "passed";
  }
  if (dayIdx > todayIdx) {
    return "upcoming";
  }
  // Тот же день недели — сравниваем время.
  const minutes = parseTime(time);
  if (minutes === null) {
    return "today";
  }
  const nowMinutes = today.hour * 60 + today.minute;
  return minutes <= nowMinutes ? "passed" : "today";
}
