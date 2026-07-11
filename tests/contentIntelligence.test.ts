import { describe, expect, it } from "vitest";
import { engagementRate } from "../src/core/analytics/engagement";
import { timeDimensions, MIDDAY_HOUR } from "../src/core/analytics/dimensions";
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
import { buildInsights } from "../src/core/analytics/insights";
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
});
