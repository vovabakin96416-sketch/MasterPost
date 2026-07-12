import { describe, expect, it } from "vitest";
import { engagementRate } from "../src/core/analytics/engagement";
import {
  timeDimensions,
  MIDDAY_HOUR,
  contentDimensionStats,
  lengthBucket,
  CHAR_LEN_SHORT_MAX,
  CHAR_LEN_LONG_MIN,
} from "../src/core/analytics/dimensions";
import {
  median,
  flagViewOutliers,
  MIN_SAMPLE_FOR_OUTLIERS,
} from "../src/core/analytics/outliers";
import { rankPostingTimes, type TimedPost } from "../src/core/analytics/bestTime";
import {
  periodStat,
  compareTrend,
  FLAT_THRESHOLD_PCT,
} from "../src/core/analytics/trend";
import { buildInsights, type Insights } from "../src/core/analytics/insights";
import {
  buildAdvice,
  MIN_POSTS_FOR_ADVICE,
  type SnapshotSummary,
} from "../src/core/analytics/advisor";
import { buildInsightsReport } from "../src/core/analytics/insightsReport";
import type { PostMetricInput } from "../src/core/analytics/weeklyReport";

const TZ = "Europe/Moscow";

function metric(over: Partial<PostMetricInput> = {}): PostMetricInput {
  return {
    messageId: 1,
    views: 100,
    reactions: 5,
    replies: 2,
    preview: "Текст",
    postedAt: new Date("2026-06-22T07:00:00Z"), // ПН 10:00 МСК
    hasMedia: false,
    hasButtons: false,
    charLen: 5,
    ...over,
  };
}

describe("engagementRate", () => {
  it("(реакции+комменты)/просмотры", () => {
    expect(engagementRate({ views: 100, reactions: 5, replies: 2 })).toBeCloseTo(0.07);
  });

  it("нулевые/отрицательные просмотры → 0 (нет деления на ноль)", () => {
    expect(engagementRate({ views: 0, reactions: 5, replies: 2 })).toBe(0);
    expect(engagementRate({ views: -1, reactions: 1, replies: 0 })).toBe(0);
  });
});

describe("timeDimensions", () => {
  it("день недели и час в поясе канала", () => {
    const d = timeDimensions(new Date("2026-06-22T07:00:00Z"), TZ);
    expect(d.weekday).toBe("monday");
    expect(d.hour).toBe(10);
    expect(d.slot).toBe("morning");
  });

  it(`час ≥ ${String(MIDDAY_HOUR)} → вечерний слот`, () => {
    const d = timeDimensions(new Date("2026-06-22T17:00:00Z"), TZ); // 20:00 МСК
    expect(d.hour).toBe(20);
    expect(d.slot).toBe("evening");
  });

  it("воскресенье распознаётся", () => {
    const d = timeDimensions(new Date("2026-06-21T07:00:00Z"), TZ);
    expect(d.weekday).toBe("sunday");
  });
});

describe("median", () => {
  it("нечётная длина — центральный элемент", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("чётная длина — среднее двух центральных", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("пусто → 0", () => {
    expect(median([])).toBe(0);
  });
});

describe("flagViewOutliers", () => {
  it("просмотры ≥ 3× медианы → выброс", () => {
    expect(flagViewOutliers([10, 10, 10, 100])).toEqual([false, false, false, true]);
  });

  it(`выборка меньше ${String(MIN_SAMPLE_FOR_OUTLIERS)} → ничего не метим`, () => {
    expect(flagViewOutliers([10, 100, 10])).toEqual([false, false, false]);
  });

  it("нулевая медиана → ничего не метим", () => {
    expect(flagViewOutliers([0, 0, 0, 0])).toEqual([false, false, false, false]);
  });
});

describe("rankPostingTimes", () => {
  function tp(postedAt: string, reactions: number): TimedPost {
    return { postedAt: new Date(postedAt), views: 100, reactions, replies: 0 };
  }

  it("сортирует ячейки день×слот по убыванию среднего ERR", () => {
    const stats = rankPostingTimes(
      [
        tp("2026-06-22T07:00:00Z", 10), // ПН утро ERR 0.10
        tp("2026-06-22T08:00:00Z", 20), // ПН утро ERR 0.20 → avg 0.15
        tp("2026-06-23T17:00:00Z", 5), // ВТ вечер ERR 0.05
      ],
      TZ,
    );
    expect(stats).toHaveLength(2);
    expect(stats[0]?.weekday).toBe("monday");
    expect(stats[0]?.slot).toBe("morning");
    expect(stats[0]?.count).toBe(2);
    expect(stats[0]?.avgErr).toBeCloseTo(0.15);
    expect(stats[1]?.slot).toBe("evening");
  });

  it("выброс исключается из статистики времени", () => {
    const stats = rankPostingTimes(
      [tp("2026-06-22T07:00:00Z", 10), tp("2026-06-22T08:00:00Z", 99)],
      TZ,
      [false, true],
    );
    expect(stats[0]?.count).toBe(1);
    expect(stats[0]?.avgErr).toBeCloseTo(0.1);
  });

  it("пусто → пустой список", () => {
    expect(rankPostingTimes([], TZ)).toEqual([]);
  });
});

describe("trend", () => {
  it("periodStat: средние по окну", () => {
    const s = periodStat([
      { views: 100, reactions: 10, replies: 0 },
      { views: 200, reactions: 10, replies: 0 },
    ]);
    expect(s.count).toBe(2);
    expect(s.avgViews).toBe(150);
    expect(s.avgErr).toBeCloseTo((0.1 + 0.05) / 2);
  });

  it("рост просмотров за зоной стабильности → up", () => {
    const c = compareTrend(
      [{ views: 200, reactions: 0, replies: 0 }],
      [{ views: 100, reactions: 0, replies: 0 }],
    );
    expect(c.viewsDeltaPct).toBeCloseTo(100);
    expect(c.viewsDirection).toBe("up");
  });

  it(`изменение меньше ${String(FLAT_THRESHOLD_PCT)}% → flat`, () => {
    const c = compareTrend(
      [{ views: 102, reactions: 0, replies: 0 }],
      [{ views: 100, reactions: 0, replies: 0 }],
    );
    expect(c.viewsDirection).toBe("flat");
  });

  it("прошлое окно пустое → дельта null и flat", () => {
    const c = compareTrend([{ views: 100, reactions: 0, replies: 0 }], []);
    expect(c.viewsDeltaPct).toBeNull();
    expect(c.viewsDirection).toBe("flat");
  });
});

describe("buildInsights", () => {
  it("лучший/худший по ERR, выброс вынесен отдельно", () => {
    const current = [
      metric({ messageId: 1, views: 100, reactions: 2, replies: 0 }), // ERR 0.02
      metric({ messageId: 2, views: 100, reactions: 30, replies: 0 }), // ERR 0.30 — лучший
      metric({ messageId: 3, views: 100, reactions: 10, replies: 0 }), // ERR 0.10
      metric({ messageId: 4, views: 5000, reactions: 1, replies: 0 }), // выброс по просмотрам
    ];
    const ins = buildInsights(current, [], TZ);
    expect(ins.count).toBe(4);
    expect(ins.outliers.map((o) => o.messageId)).toEqual([4]);
    expect(ins.best?.post.messageId).toBe(2);
    expect(ins.worst?.post.messageId).toBe(1);
  });

  it("пустой вход → нули и null", () => {
    const ins = buildInsights([], [], TZ);
    expect(ins.count).toBe(0);
    expect(ins.best).toBeNull();
    expect(ins.worst).toBeNull();
    expect(ins.bestTimes).toEqual([]);
  });

  it("тренд считается против прошлого окна", () => {
    const ins = buildInsights(
      [metric({ views: 200, reactions: 0, replies: 0 })],
      [metric({ views: 100, reactions: 0, replies: 0 })],
      TZ,
    );
    expect(ins.trend.viewsDirection).toBe("up");
  });

  it("12f: виральный пост в текущем окне НЕ даёт ложный рост тренда", () => {
    const flat = (id: number, views = 100): PostMetricInput =>
      metric({ messageId: id, views, reactions: 0, replies: 0 });
    const ins = buildInsights(
      [flat(1), flat(2), flat(3), flat(4, 5000)], // выброс по просмотрам
      [flat(11), flat(12), flat(13), flat(14)],
      TZ,
    );
    expect(ins.outliers.map((o) => o.messageId)).toEqual([4]);
    expect(ins.trend.viewsDirection).toBe("flat"); // без фильтра было бы up
  });

  it("12f: выброс в ПРОШЛОМ окне не завышает базу (нет ложного падения)", () => {
    const flat = (id: number, views = 100): PostMetricInput =>
      metric({ messageId: id, views, reactions: 0, replies: 0 });
    const ins = buildInsights(
      [flat(1), flat(2), flat(3), flat(4)],
      [flat(11), flat(12), flat(13), flat(14, 5000)],
      TZ,
    );
    expect(ins.trend.viewsDirection).toBe("flat"); // без фильтра было бы down
  });

  it(`12f: окно меньше ${String(MIN_SAMPLE_FOR_OUTLIERS)} постов — тренд по всем постам (флагов нет)`, () => {
    const flat = (id: number, views: number): PostMetricInput =>
      metric({ messageId: id, views, reactions: 0, replies: 0 });
    const ins = buildInsights(
      [flat(1, 300), flat(2, 10), flat(3, 10)], // 3 поста → детект выключен
      [flat(11, 100)],
      TZ,
    );
    expect(ins.outliers).toEqual([]);
    expect(ins.trend.current.avgViews).toBeCloseTo((300 + 10 + 10) / 3);
  });
});

describe("lengthBucket", () => {
  it("границы short/medium/long", () => {
    expect(lengthBucket(CHAR_LEN_SHORT_MAX - 1)).toBe("short");
    expect(lengthBucket(CHAR_LEN_SHORT_MAX)).toBe("medium");
    expect(lengthBucket(CHAR_LEN_LONG_MIN - 1)).toBe("medium");
    expect(lengthBucket(CHAR_LEN_LONG_MIN)).toBe("long");
  });
});

describe("contentDimensionStats", () => {
  it("средний ERR и число постов по медиа", () => {
    const stats = contentDimensionStats([
      metric({ hasMedia: true, reactions: 10, replies: 2 }), // ERR 0.12
      metric({ hasMedia: false, reactions: 0, replies: 0 }), // ERR 0
    ]);
    expect(stats.withMedia.count).toBe(1);
    expect(stats.withMedia.avgErr).toBeCloseTo(0.12);
    expect(stats.withoutMedia.count).toBe(1);
    expect(stats.withoutMedia.avgErr).toBe(0);
  });

  it("пустой вход → нули по всем группам", () => {
    const stats = contentDimensionStats([]);
    expect(stats.withMedia).toEqual({ count: 0, avgErr: 0 });
    expect(stats.length.short).toEqual({ count: 0, avgErr: 0 });
  });
});

/** 4 поста ПН 10:00 МСК (morning) с разным откликом — база для советника/отчёта. */
function currentWindow(): PostMetricInput[] {
  return [
    metric({ messageId: 1, views: 100, reactions: 2, replies: 0 }), // ERR 0.02
    metric({ messageId: 2, views: 100, reactions: 20, replies: 0 }), // ERR 0.20 (лучший)
    metric({ messageId: 3, views: 100, reactions: 10, replies: 0 }), // ERR 0.10
    metric({ messageId: 4, views: 5000, reactions: 1, replies: 0 }), // выброс
  ];
}

describe("buildAdvice", () => {
  it(`меньше ${String(MIN_POSTS_FOR_ADVICE)} постов → только not_enough_data`, () => {
    const ins = buildInsights([metric(), metric({ messageId: 2 })], [], TZ);
    const advice = buildAdvice(ins, contentDimensionStats([]), null);
    expect(advice).toEqual([{ kind: "not_enough_data", priority: 0, count: 2 }]);
  });

  it("достаточно данных → best_slot, trend, outliers (по приоритету)", () => {
    const current = currentWindow();
    const ins = buildInsights(current, [], TZ);
    const advice = buildAdvice(ins, contentDimensionStats(current), null);
    const kinds = advice.map((a) => a.kind);
    expect(kinds).toContain("best_slot");
    expect(kinds).toContain("trend");
    expect(kinds).toContain("outliers");
    expect(kinds.indexOf("best_slot")).toBeLessThan(kinds.indexOf("trend"));
    expect(kinds.indexOf("trend")).toBeLessThan(kinds.indexOf("outliers"));
  });

  it("нативный топ-час в том же слоте → matchesOwn=true, Δ подписчиков считается", () => {
    const current = currentWindow();
    const ins = buildInsights(current, [], TZ);
    const snap: SnapshotSummary = {
      nativeTopHoursLocal: [9, 10],
      subscribers: 500,
      previousSubscribers: 480,
    };
    const advice = buildAdvice(ins, contentDimensionStats(current), snap);
    const native = advice.find((a) => a.kind === "native_hours");
    expect(native?.kind === "native_hours" && native.matchesOwn).toBe(true);
    const trend = advice.find((a) => a.kind === "trend");
    expect(trend?.kind === "trend" && trend.subscribersDelta).toBe(20);
  });

  it("нативный топ-час в другом слоте → matchesOwn=false", () => {
    const current = currentWindow();
    const ins = buildInsights(current, [], TZ);
    const snap: SnapshotSummary = {
      nativeTopHoursLocal: [20], // вечер, а лучший слот — утро
      subscribers: null,
      previousSubscribers: null,
    };
    const advice = buildAdvice(ins, contentDimensionStats(current), snap);
    const native = advice.find((a) => a.kind === "native_hours");
    expect(native?.kind === "native_hours" && native.matchesOwn).toBe(false);
  });

  it("медиа заходит лучше → content_media prefer=with", () => {
    const current = [
      metric({ messageId: 1, hasMedia: true, reactions: 30, replies: 0 }),
      metric({ messageId: 2, hasMedia: true, reactions: 28, replies: 0 }),
      metric({ messageId: 3, hasMedia: false, reactions: 2, replies: 0 }),
      metric({ messageId: 4, hasMedia: false, reactions: 1, replies: 0 }),
    ];
    const ins = buildInsights(current, [], TZ);
    const advice = buildAdvice(ins, contentDimensionStats(current), null);
    const media = advice.find((a) => a.kind === "content_media");
    expect(media?.kind === "content_media" && media.prefer).toBe("with");
  });
});

describe("buildInsightsReport", () => {
  it("пустые данные → понятная заглушка, без Markdown-эмфазы", () => {
    const empty: Insights = buildInsights([], [], TZ);
    const txt = buildInsightsReport(empty, [], []);
    expect(txt).toContain("не найдено");
    expect(txt).not.toMatch(/[*_]/);
  });

  it("содержит разделы «что зашло / лучшее время / рекомендации» без Markdown-эмфазы", () => {
    const current = currentWindow();
    const ins = buildInsights(current, [], TZ);
    const advice = buildAdvice(ins, contentDimensionStats(current), {
      nativeTopHoursLocal: [19],
      subscribers: 500,
      previousSubscribers: 490,
    });
    const txt = buildInsightsReport(ins, advice, [19]);
    expect(txt).toContain("📈 Рост канала");
    expect(txt).toContain("🔥 Что зашло");
    expect(txt).toContain("🕐 Лучшее время");
    expect(txt).toContain("💡 Рекомендации");
    expect(txt).toContain("Нативно");
    expect(txt).not.toMatch(/[*_]/);
  });
});
