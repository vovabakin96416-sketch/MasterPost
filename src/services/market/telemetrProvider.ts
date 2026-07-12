import { z } from "zod";
import type { Logger } from "pino";
import type {
  ChannelMarketStat,
  MarketDataProvider,
} from "../../core/market/marketData.js";

/**
 * Адаптер Telemetr (Шаг 12e) — тонкий HTTP-клиент за интерфейсом
 * `MarketDataProvider`. Единственное место в коде, знающее про Telemetr.
 *
 * Мягкая деградация (как Pexels 6a): нет ключа → провайдера нет; не-2xx (в т.ч.
 * 429 при лимите тарифа) / `status != "ok"` / кривой JSON / сеть / таймаут →
 * `null` + warn, бот не падает. Ключ — ТОЛЬКО из env (`TELEMETR_API_KEY`).
 */

const DEFAULT_BASE_URL = "https://api.telemetr.me";
const DEFAULT_TIMEOUT_MS = 8000;

/** Минимально нужная форма ответа `GET /channels/stat` (остальные поля не читаем). */
const statResponseSchema = z.object({
  status: z.literal("ok"),
  response: z.object({
    participants_count: z.number(),
    avg_post_reach: z.number(),
    err_percent: z.number(),
    daily_reach: z.number(),
    mentions_count: z.number(),
  }),
});

/** Подмножество fetch, которое нужно адаптеру (инъекция в тестах). */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Конфиг адаптера: ключ обязателен по смыслу, остальное — для тестов/отладки. */
export interface TelemetrConfig {
  readonly apiKey: string | undefined;
  readonly logger: Logger;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchLike;
}

/**
 * Создаёт провайдера рыночных данных поверх Telemetr API. Без ключа → `null`:
 * вызывающий понимает «рыночный слой выключен» ещё до первого запроса.
 */
export function createTelemetrProvider(
  cfg: TelemetrConfig,
): MarketDataProvider | null {
  const apiKey = cfg.apiKey;
  if (apiKey === undefined || apiKey === "") {
    return null;
  }
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn: FetchLike = cfg.fetchFn ?? fetch;

  return {
    name: "telemetr",

    async fetchChannelStat(channelRef): Promise<ChannelMarketStat | null> {
      try {
        const url = new URL("/channels/stat", baseUrl);
        url.searchParams.set("channelId", channelRef);
        const resp = await fetchFn(url.toString(), {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) {
          cfg.logger.warn(
            { status: resp.status },
            "Telemetr: ответ не 2xx (429 = лимит тарифа)",
          );
          return null;
        }
        const parsed = statResponseSchema.safeParse(await resp.json());
        if (!parsed.success) {
          cfg.logger.warn("Telemetr: неожиданная форма ответа /channels/stat");
          return null;
        }
        const r = parsed.data.response;
        return {
          subscribers: r.participants_count,
          avgPostReach: r.avg_post_reach,
          errPercent: r.err_percent,
          dailyReach: r.daily_reach,
          mentionsCount: r.mentions_count,
        };
      } catch (err) {
        cfg.logger.warn({ err }, "Telemetr: ошибка запроса");
        return null;
      }
    },
  };
}
