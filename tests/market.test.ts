import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import type { ChannelMarketStat } from "../src/core/market/marketData";
import {
  MARKET_CACHE_TTL_MS,
  isCacheFresh,
  parseMarketCache,
} from "../src/core/market/marketCache";
import { buildMarketSection } from "../src/core/market/marketSection";
import {
  createTelemetrProvider,
  type FetchLike,
} from "../src/services/market/telemetrProvider";

/** Тихий логгер-заглушка (как в growthNarrative.test.ts). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const STAT: ChannelMarketStat = {
  subscribers: 401,
  avgPostReach: 38,
  errPercent: 6.51,
  dailyReach: 28,
  mentionsCount: 10,
};

describe("buildMarketSection (Шаг 12e)", () => {
  it("полные данные: внешние цифры + сравнение со своим ERR", () => {
    const text = buildMarketSection(STAT, { avgErr7d: 0.042 });
    expect(text).toContain("🌍 Рынок (Telemetr)");
    expect(text).toContain("Подписчиков: 401");
    expect(text).toContain("охват поста: ~38");
    expect(text).toContain("ERR по Telemetr: 6.5%");
    expect(text).toContain("свой расчёт за 7 дней: 4.2%");
    expect(text).toContain("Упоминаний другими каналами: 10");
  });

  it("без своего ERR — только внешние цифры, без сравнения", () => {
    const text = buildMarketSection(STAT, { avgErr7d: null });
    expect(text).toContain("ERR по Telemetr: 6.5%");
    expect(text).not.toContain("свой расчёт");
  });

  it("без Markdown-эмфазы (* и _) — правило 12c", () => {
    const text = buildMarketSection(STAT, { avgErr7d: 0.042 });
    expect(text).not.toMatch(/[*_]/);
  });
});

describe("parseMarketCache / isCacheFresh (Шаг 12e)", () => {
  const raw = { fetchedAt: "2026-07-12T10:00:00.000Z", stat: { ...STAT } };

  it("валидный JSON → кэш с датой и срезом", () => {
    const cache = parseMarketCache(raw);
    expect(cache).not.toBeNull();
    expect(cache?.stat.subscribers).toBe(401);
    expect(cache?.fetchedAt.toISOString()).toBe("2026-07-12T10:00:00.000Z");
  });

  it("кривая форма / нечитаемая дата → null", () => {
    expect(parseMarketCache(undefined)).toBeNull();
    expect(parseMarketCache("мусор")).toBeNull();
    expect(parseMarketCache({ fetchedAt: "не-дата", stat: { ...STAT } })).toBeNull();
    expect(parseMarketCache({ fetchedAt: raw.fetchedAt })).toBeNull();
  });

  it("свежесть: моложе TTL — свежий, старше — протух", () => {
    const fetchedAt = new Date("2026-07-12T00:00:00Z");
    const soon = new Date(fetchedAt.getTime() + MARKET_CACHE_TTL_MS - 1);
    const late = new Date(fetchedAt.getTime() + MARKET_CACHE_TTL_MS + 1);
    expect(isCacheFresh(fetchedAt, soon)).toBe(true);
    expect(isCacheFresh(fetchedAt, late)).toBe(false);
  });
});

/** Фейковый fetch с заданным ответом (инъекция, сеть не трогаем). */
function fakeFetch(status: number, body: unknown): FetchLike {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
}

const OK_BODY = {
  status: "ok",
  response: {
    participants_count: 401,
    avg_post_reach: 38,
    err_percent: 6.51,
    daily_reach: 28,
    mentions_count: 10,
    posts_count: 93, // лишние поля API схема игнорирует
  },
};

describe("createTelemetrProvider (Шаг 12e)", () => {
  it("без ключа → провайдера нет (рыночный слой выключен)", () => {
    expect(
      createTelemetrProvider({ apiKey: undefined, logger: silentLogger }),
    ).toBeNull();
    expect(
      createTelemetrProvider({ apiKey: "", logger: silentLogger }),
    ).toBeNull();
  });

  it("валидный ответ → срез, channelId уходит в запрос", async () => {
    let requested = "";
    const fetchFn: FetchLike = (url) => {
      requested = url;
      return fakeFetch(200, OK_BODY)(url, {
        headers: {},
        signal: AbortSignal.timeout(1000),
      });
    };
    const provider = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn,
    });
    const stat = await provider?.fetchChannelStat("@sofia_gada1ka");
    expect(stat).toEqual(STAT);
    expect(requested).toContain("/channels/stat");
    expect(requested).toContain("channelId=%40sofia_gada1ka");
  });

  it("HTTP 429 (лимит тарифа) → null, не бросает", async () => {
    const provider = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: fakeFetch(429, {}),
    });
    expect(await provider?.fetchChannelStat("@x")).toBeNull();
  });

  it("status != ok / кривой JSON → null", async () => {
    const err = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: fakeFetch(200, { status: "error", error: "no access" }),
    });
    expect(await err?.fetchChannelStat("@x")).toBeNull();

    const broken = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: fakeFetch(200, { status: "ok", response: { participants_count: "401" } }),
    });
    expect(await broken?.fetchChannelStat("@x")).toBeNull();
  });

  it("сеть бросает → null (мягкая деградация)", async () => {
    const provider = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: () => Promise.reject(new Error("ECONNRESET")),
    });
    expect(await provider?.fetchChannelStat("@x")).toBeNull();
  });
});
