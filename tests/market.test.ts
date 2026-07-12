import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import type {
  ChannelMarketStat,
  SubscriberPoint,
} from "../src/core/market/marketData";
import {
  MARKET_CACHE_TTL_MS,
  isCacheFresh,
  parseMarketCache,
} from "../src/core/market/marketCache";
import { buildMarketSection } from "../src/core/market/marketSection";
import { computeSubscriberDynamics } from "../src/core/market/subscriberDynamics";
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

  it("с динамикой (12e-2): строка роста со знаком, минус при оттоке", () => {
    const grow = buildMarketSection(
      STAT,
      { avgErr7d: null },
      { current: 417, delta7d: 3, delta28d: 14 },
    );
    expect(grow).toContain("📈 Подписчики за 7д: +3 · за 28д: +14");
    expect(grow).not.toMatch(/[*_]/);

    const shrink = buildMarketSection(
      STAT,
      { avgErr7d: null },
      { current: 400, delta7d: -2, delta28d: null },
    );
    expect(shrink).toContain("за 7д: -2");
    expect(shrink).not.toContain("за 28д");
  });

  it("без динамики / без единой дельты — строки роста нет", () => {
    expect(buildMarketSection(STAT, { avgErr7d: null })).not.toContain(
      "📈 Подписчики",
    );
    expect(
      buildMarketSection(
        STAT,
        { avgErr7d: null },
        { current: 417, delta7d: null, delta28d: null },
      ),
    ).not.toContain("📈 Подписчики");
  });
});

describe("computeSubscriberDynamics (Шаг 12e-2)", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("рост: Δ7д и Δ28д от базовых точек окна", () => {
    const points: SubscriberPoint[] = [
      { date: "2026-06-14", count: 403 },
      { date: "2026-07-05", count: 410 },
      { date: "2026-07-12", count: 417 },
    ];
    expect(computeSubscriberDynamics(points, now)).toEqual({
      current: 417,
      delta7d: 7, // база — 2026-07-05 (последняя точка не моложе границы 7д)
      delta28d: 14, // база — 2026-06-14
    });
  });

  it("отток: дельты отрицательные, порядок точек не важен", () => {
    const points: SubscriberPoint[] = [
      { date: "2026-07-12", count: 395 },
      { date: "2026-06-14", count: 403 },
      { date: "2026-07-04", count: 401 },
    ];
    expect(computeSubscriberDynamics(points, now)).toEqual({
      current: 395,
      delta7d: -6,
      delta28d: -8,
    });
  });

  it("история короче окна: нет базы → дельта null (не занижаем)", () => {
    const points: SubscriberPoint[] = [
      { date: "2026-07-10", count: 415 },
      { date: "2026-07-12", count: 417 },
    ];
    expect(computeSubscriberDynamics(points, now)).toEqual({
      current: 417,
      delta7d: null,
      delta28d: null,
    });
  });

  it("пустой ряд → null", () => {
    expect(computeSubscriberDynamics([], now)).toBeNull();
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

  it("кэш 12e-1 без ряда подписчиков валиден (subscribers: null), с рядом — парсится", () => {
    expect(parseMarketCache(raw)?.subscribers).toBeNull();

    const cache = parseMarketCache({
      ...raw,
      subscribers: [{ date: "2026-07-12", count: 417 }],
    });
    expect(cache?.subscribers).toEqual([{ date: "2026-07-12", count: 417 }]);
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

const SUBSCRIBERS_BODY = {
  status: "ok",
  response: [
    // Реальный порядок API — новые сверху (ядро сортирует само).
    { date: "2026-07-12", participantsCount: 417 },
    { date: "2026-07-11", participantsCount: 417 },
    { date: "2026-06-15", participantsCount: 403 },
  ],
};

describe("fetchSubscriberHistory (Шаг 12e-2)", () => {
  it("валидный ответ → точки; окно day с датами уходит в запрос", async () => {
    let requested = "";
    const fetchFn: FetchLike = (url) => {
      requested = url;
      return fakeFetch(200, SUBSCRIBERS_BODY)(url, {
        headers: {},
        signal: AbortSignal.timeout(1000),
      });
    };
    const provider = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn,
    });
    const points = await provider?.fetchSubscriberHistory("@sofia_gada1ka");
    expect(points).toEqual([
      { date: "2026-07-12", count: 417 },
      { date: "2026-07-11", count: 417 },
      { date: "2026-06-15", count: 403 },
    ]);
    expect(requested).toContain("/channels/subscribers");
    expect(requested).toContain("channelId=%40sofia_gada1ka");
    expect(requested).toContain("group=day");
    expect(requested).toContain("start_date=");
    expect(requested).toContain("end_date=");
  });

  it("HTTP 400 (кривой интервал) / 429 (лимит) → null, не бросает", async () => {
    for (const status of [400, 429]) {
      const provider = createTelemetrProvider({
        apiKey: "k",
        logger: silentLogger,
        fetchFn: fakeFetch(status, {}),
      });
      expect(await provider?.fetchSubscriberHistory("@x")).toBeNull();
    }
  });

  it("status != ok / кривой JSON → null", async () => {
    const err = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: fakeFetch(200, { status: "error" }),
    });
    expect(await err?.fetchSubscriberHistory("@x")).toBeNull();

    const broken = createTelemetrProvider({
      apiKey: "k",
      logger: silentLogger,
      fetchFn: fakeFetch(200, {
        status: "ok",
        response: [{ date: "2026-07-12", participantsCount: "417" }],
      }),
    });
    expect(await broken?.fetchSubscriberHistory("@x")).toBeNull();
  });
});
