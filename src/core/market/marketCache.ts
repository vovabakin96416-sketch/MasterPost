import { z } from "zod";
import type { ChannelMarketStat } from "./marketData.js";

/**
 * Кэш рыночного среза (Шаг 12e) — ЧИСТАЯ логика без БД.
 *
 * Зачем: у Telemetr свой лимит запросов (10k/мес), жечь его на каждое открытие
 * экрана «📈 Рост» нельзя. Срез храним в `Setting` канала (ключ
 * `MARKET_CACHE_KEY`) и обновляем не чаще, чем раз в `MARKET_CACHE_TTL_MS`.
 * Здесь — только разбор/проверка свежести; чтение и запись — в сервисе.
 */

/** Ключ настройки канала, под которым лежит кэшированный срез. */
export const MARKET_CACHE_KEY = "market_stat_cache";

/** TTL кэша — 12 часов: рыночные агрегаты меняются медленно, лимит бережём. */
export const MARKET_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Схема того, что лежит в Setting: момент снятия + сам срез. */
const cachedStatSchema = z.object({
  fetchedAt: z.string().min(1),
  stat: z.object({
    subscribers: z.number(),
    avgPostReach: z.number(),
    errPercent: z.number(),
    dailyReach: z.number(),
    mentionsCount: z.number(),
  }),
});

/** Разобранный кэш: когда снят и что снято. */
export interface MarketStatCache {
  readonly fetchedAt: Date;
  readonly stat: ChannelMarketStat;
}

/**
 * Разбирает сырое JSON-значение настройки в кэш. Кривая форма / нечитаемая
 * дата → `null` (кэша нет, сервис пойдёт за свежими данными).
 */
export function parseMarketCache(value: unknown): MarketStatCache | null {
  const parsed = cachedStatSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const fetchedAt = new Date(parsed.data.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) {
    return null;
  }
  return { fetchedAt, stat: parsed.data.stat };
}

/** Свежий ли кэш: моложе TTL относительно `now`. */
export function isCacheFresh(
  fetchedAt: Date,
  now: Date,
  ttlMs: number = MARKET_CACHE_TTL_MS,
): boolean {
  return now.getTime() - fetchedAt.getTime() < ttlMs;
}
