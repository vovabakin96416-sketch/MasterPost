import { z } from "zod";
import type { Logger } from "pino";
import type {
  ChannelMarketStat,
  MarketDataProvider,
  SubscriberPoint,
} from "../../core/market/marketData.js";
import { SUBSCRIBER_WINDOW_DAYS } from "../../core/market/subscriberDynamics.js";

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

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Форма ответа `GET /channels/subscribers` (12e-2): точки по дням, новые сверху. */
const subscribersResponseSchema = z.object({
  status: z.literal("ok"),
  response: z.array(
    z.object({
      date: z.string().min(1),
      participantsCount: z.number(),
    }),
  ),
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

/** Дата в формате Telemetr `YYYY-MM-DD HH:MM:SS` (UTC). */
function telemetrDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
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

  /** Общий запрос: не-2xx / сеть / таймаут → null + warn, JSON — вызывающему. */
  async function requestJson(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown | null> {
    try {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      const resp = await fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        cfg.logger.warn(
          { status: resp.status, path },
          "Telemetr: ответ не 2xx (429 = лимит тарифа)",
        );
        return null;
      }
      return await resp.json();
    } catch (err) {
      cfg.logger.warn({ err, path }, "Telemetr: ошибка запроса");
      return null;
    }
  }

  return {
    name: "telemetr",

    async fetchChannelStat(channelRef): Promise<ChannelMarketStat | null> {
      const body = await requestJson("/channels/stat", {
        channelId: channelRef,
      });
      if (body === null) {
        return null;
      }
      const parsed = statResponseSchema.safeParse(body);
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
    },

    async fetchSubscriberHistory(
      channelRef,
    ): Promise<readonly SubscriberPoint[] | null> {
      // Окно 28 дней: ровно месяц API отклоняет (HTTP 400 «Неверный интервал дат»).
      const now = new Date();
      const body = await requestJson("/channels/subscribers", {
        channelId: channelRef,
        group: "day",
        start_date: telemetrDate(
          new Date(now.getTime() - SUBSCRIBER_WINDOW_DAYS * DAY_MS),
        ),
        end_date: telemetrDate(now),
      });
      if (body === null) {
        return null;
      }
      const parsed = subscribersResponseSchema.safeParse(body);
      if (!parsed.success) {
        cfg.logger.warn(
          "Telemetr: неожиданная форма ответа /channels/subscribers",
        );
        return null;
      }
      return parsed.data.response.map((p) => ({
        date: p.date,
        count: p.participantsCount,
      }));
    },
  };
}
