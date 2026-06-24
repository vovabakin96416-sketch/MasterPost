import type { LocalDateParts, Weekday } from "./localDate.js";

/**
 * Расчёт «недели и дня контент-плана на сегодня» — ЧИСТАЯ логика, под тестами.
 *
 * Порт `bot.py:get_post_for_today`: контент-план длится 4 недели и идёт по кругу.
 * `week = floor(delta_days / 7) % 4 + 1`, где `delta_days` — сколько дней прошло
 * от старта кампании (`campaignStart`) до сегодня. День недели берём как есть.
 *
 * Работаем над уже вычисленными локальными частями даты канала (см. localDate.ts),
 * поэтому функция не зависит от часовых поясов и тестируема напрямую.
 */

export interface CampaignDay {
  /** Номер недели плана, 1..4 (по кругу). */
  readonly week: number;
  readonly day: Weekday;
}

/** Календарная дата как число дней от эпохи (для разницы дат без учёта времени). */
function dayNumber(parts: LocalDateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

/**
 * @param today  локальные части «сегодня» в поясе канала
 * @param start  локальные части даты старта кампании, или `null` (= старт сегодня)
 */
export function resolveCampaignDay(
  today: LocalDateParts,
  start: LocalDateParts | null,
): CampaignDay {
  if (start === null) {
    return { week: 1, day: today.weekday };
  }
  const delta = dayNumber(today) - dayNumber(start);
  // Старт в будущем (delta < 0) трактуем как первую неделю.
  const safeDelta = delta < 0 ? 0 : delta;
  const week = (Math.floor(safeDelta / 7) % 4) + 1;
  return { week, day: today.weekday };
}
