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
