import { describe, expect, it } from "vitest";
import {
  EXPLORATION_ONE_IN,
  STRATEGY_TTL_MS,
  buildStrategyDirective,
  buildStrategySummary,
  isExplorationPost,
  isStrategyExpired,
  parseLearnedStrategy,
  recordWinner,
  strategyDaysLeft,
  type LearnedStrategyEntry,
} from "../src/core/experiments/learnedStrategy";

const NOW = new Date("2026-07-13T00:00:00Z");

/** Запись, выученная `daysAgo` дней назад от NOW. */
function entry(
  dimension: string,
  variantKey: string,
  daysAgo = 0,
): LearnedStrategyEntry {
  const learnedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return { dimension, variantKey, learnedAt };
}

describe("parseLearnedStrategy (Шаг 13e)", () => {
  it("валидный массив разбирается", () => {
    const raw = [{ dimension: "media", variantKey: "with_photo", learnedAt: "2026-07-01T00:00:00Z" }];
    expect(parseLearnedStrategy(raw)).toHaveLength(1);
  });

  it("не массив / кривые записи → []", () => {
    expect(parseLearnedStrategy(null)).toEqual([]);
    expect(parseLearnedStrategy({ dimension: "media" })).toEqual([]);
    expect(parseLearnedStrategy([{ dimension: "", variantKey: "x", learnedAt: "z" }])).toEqual([]);
  });
});

describe("isStrategyExpired / strategyDaysLeft", () => {
  it("свежая запись не просрочена, остаток дней > 0", () => {
    const e = entry("media", "with_photo", 1);
    expect(isStrategyExpired(e, NOW)).toBe(false);
    expect(strategyDaysLeft(e, NOW)).toBeGreaterThan(0);
  });

  it("старше срока годности → просрочена, остаток 0", () => {
    const old = new Date(NOW.getTime() - STRATEGY_TTL_MS - 1000).toISOString();
    const e: LearnedStrategyEntry = { dimension: "media", variantKey: "with_photo", learnedAt: old };
    expect(isStrategyExpired(e, NOW)).toBe(true);
    expect(strategyDaysLeft(e, NOW)).toBe(0);
  });

  it("кривая дата → считаем просроченной", () => {
    const e: LearnedStrategyEntry = { dimension: "media", variantKey: "with_photo", learnedAt: "не-дата" };
    expect(isStrategyExpired(e, NOW)).toBe(true);
  });
});

describe("recordWinner", () => {
  it("добавляет запись измерения", () => {
    const result = recordWinner([], "cta_style", "question", NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.variantKey).toBe("question");
  });

  it("новый победитель того же измерения вытесняет прежний, другие не трогает", () => {
    const start = [entry("cta_style", "question", 10), entry("media", "with_photo", 3)];
    const result = recordWinner(start, "cta_style", "action", NOW);
    expect(result).toHaveLength(2);
    const cta = result.find((e) => e.dimension === "cta_style");
    expect(cta?.variantKey).toBe("action");
    expect(cta?.learnedAt).toBe(NOW.toISOString());
    expect(result.find((e) => e.dimension === "media")?.variantKey).toBe("with_photo");
  });
});

describe("isExplorationPost (~75/25)", () => {
  it("каждый 4-й пост в окне — разведочный", () => {
    const flags = [0, 1, 2, 3, 4, 5, 6, 7].map(isExplorationPost);
    expect(flags).toEqual([false, false, false, true, false, false, false, true]);
  });

  it("ровно 25% из окна EXPLORATION_ONE_IN", () => {
    const window = Array.from({ length: EXPLORATION_ONE_IN }, (_, i) => isExplorationPost(i));
    expect(window.filter(Boolean)).toHaveLength(1);
  });
});

describe("buildStrategyDirective", () => {
  it("собирает директивы активных записей через перевод строки", () => {
    const entries = [entry("media", "with_photo"), entry("length", "short")];
    const directive = buildStrategyDirective(entries, NOW);
    expect(directive).toContain("\n");
    expect(directive.length).toBeGreaterThan(0);
  });

  it("исключает измерение под активным экспериментом", () => {
    const entries = [entry("media", "with_photo"), entry("length", "short")];
    const only = buildStrategyDirective(entries, NOW, "media");
    const both = buildStrategyDirective(entries, NOW, null);
    expect(only.split("\n")).toHaveLength(1);
    expect(both.split("\n")).toHaveLength(2);
  });

  it("просроченные и неизвестные записи пропускаются → пустая строка", () => {
    const old = new Date(NOW.getTime() - STRATEGY_TTL_MS - 1000).toISOString();
    const entries: LearnedStrategyEntry[] = [
      { dimension: "media", variantKey: "with_photo", learnedAt: old },
      { dimension: "unknown_dim", variantKey: "x", learnedAt: NOW.toISOString() },
      { dimension: "cta_style", variantKey: "no_such_variant", learnedAt: NOW.toISOString() },
    ];
    expect(buildStrategyDirective(entries, NOW)).toBe("");
  });
});

describe("buildStrategySummary", () => {
  it("нет записей → поясняющая строка", () => {
    expect(buildStrategySummary([], NOW)).toBe("Выученных предпочтений пока нет.");
  });

  it("активная запись → подпись варианта + остаток дней", () => {
    const text = buildStrategySummary([entry("cta_style", "question", 1)], NOW);
    expect(text).toContain("Стиль CTA");
    expect(text).toContain("ещё");
  });

  it("просроченная запись помечается на перепроверку", () => {
    const old = new Date(NOW.getTime() - STRATEGY_TTL_MS - 1000).toISOString();
    const text = buildStrategySummary(
      [{ dimension: "media", variantKey: "with_photo", learnedAt: old }],
      NOW,
    );
    expect(text).toContain("устарел");
  });
});
