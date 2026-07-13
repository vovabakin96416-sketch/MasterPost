import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_DIMENSIONS,
  getDimensionSpec,
} from "../src/core/experiments/experiment";
import { assignVariant } from "../src/core/experiments/assignVariant";
import {
  evaluateExperiment,
  MIN_POSTS_PER_VARIANT,
  WINNER_THRESHOLD_PCT,
  type VariantSample,
} from "../src/core/experiments/evaluateExperiment";
import type { EngagementLike } from "../src/core/analytics/engagement";

/** Пост с заданным ERR при 100 просмотрах (реакции = ERR×100, комментов 0). */
function post(err: number, views = 100): EngagementLike {
  return { views, reactions: Math.round(err * views), replies: 0 };
}

/** Выборка варианта: n постов с одинаковым ERR. */
function sample(key: string, n: number, err: number): VariantSample {
  return { key, posts: Array.from({ length: n }, () => post(err)) };
}

describe("EXPERIMENT_DIMENSIONS (каталог измерений)", () => {
  it("каждое измерение: уникальный ключ, ≥2 вариантов с уникальными ключами", () => {
    const dims = EXPERIMENT_DIMENSIONS.map((d) => d.dimension);
    expect(new Set(dims).size).toBe(dims.length);
    for (const spec of EXPERIMENT_DIMENSIONS) {
      expect(spec.variants.length).toBeGreaterThanOrEqual(2);
      const keys = spec.variants.map((v) => v.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("у каждого варианта есть непустая директива для промпта (13c)", () => {
    for (const spec of EXPERIMENT_DIMENSIONS) {
      for (const variant of spec.variants) {
        expect(variant.directive.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("getDimensionSpec: известное → спека, неизвестное → null", () => {
    expect(getDimensionSpec("cta_style")?.label).toBe("Стиль CTA");
    expect(getDimensionSpec("nope")).toBeNull();
  });
});

describe("assignVariant (ротация)", () => {
  const variants = [
    { key: "a", label: "А", directive: "форма А" },
    { key: "b", label: "Б", directive: "форма Б" },
  ];

  it("детерминированное чередование А,Б,А,Б по счётчику", () => {
    expect(assignVariant(variants, 0)?.key).toBe("a");
    expect(assignVariant(variants, 1)?.key).toBe("b");
    expect(assignVariant(variants, 2)?.key).toBe("a");
    expect(assignVariant(variants, 3)?.key).toBe("b");
  });

  it("пустой список / кривой счётчик → null", () => {
    expect(assignVariant([], 0)).toBeNull();
    expect(assignVariant(variants, -1)).toBeNull();
    expect(assignVariant(variants, 1.5)).toBeNull();
  });
});

describe("evaluateExperiment (вердикт)", () => {
  it("мало данных → continue, postsNeeded = суммарная недостача", () => {
    const verdict = evaluateExperiment([sample("a", 2, 0.07), sample("b", 1, 0.07)]);
    expect(verdict.status).toBe("continue");
    if (verdict.status === "continue") {
      expect(verdict.postsNeeded).toBe(
        MIN_POSTS_PER_VARIANT - 2 + (MIN_POSTS_PER_VARIANT - 1),
      );
    }
  });

  it("меньше двух вариантов → continue (сравнивать не с чем)", () => {
    const verdict = evaluateExperiment([sample("a", MIN_POSTS_PER_VARIANT, 0.07)]);
    expect(verdict.status).toBe("continue");
  });

  it("явное превосходство → winner с deltaPct", () => {
    const verdict = evaluateExperiment([
      sample("a", MIN_POSTS_PER_VARIANT, 0.1),
      sample("b", MIN_POSTS_PER_VARIANT, 0.07),
    ]);
    expect(verdict.status).toBe("winner");
    if (verdict.status === "winner") {
      expect(verdict.variantKey).toBe("a");
      expect(verdict.deltaPct).toBeGreaterThan(WINNER_THRESHOLD_PCT);
    }
  });

  it("разница ниже порога (Δ≈14%) → no_difference", () => {
    const verdict = evaluateExperiment([
      sample("a", MIN_POSTS_PER_VARIANT, 0.08),
      sample("b", MIN_POSTS_PER_VARIANT, 0.07),
    ]);
    expect(verdict.status).toBe("no_difference");
  });

  it("виральный выброс не делает вариант победителем (фильтр 12a по общему пулу)", () => {
    const viral: EngagementLike = { views: 1000, reactions: 300, replies: 0 }; // ERR 0.3
    const b: VariantSample = {
      key: "b",
      posts: [...Array.from({ length: MIN_POSTS_PER_VARIANT }, () => post(0.07)), viral],
    };
    const verdict = evaluateExperiment([sample("a", MIN_POSTS_PER_VARIANT, 0.07), b]);
    // без фильтра b выиграл бы (+54%); выброс исключён → разницы нет
    expect(verdict.status).toBe("no_difference");
  });

  it("guard-метрика: победитель при оттоке подписчиков → suspicious", () => {
    const verdict = evaluateExperiment(
      [sample("a", MIN_POSTS_PER_VARIANT, 0.1), sample("b", MIN_POSTS_PER_VARIANT, 0.07)],
      -12,
    );
    expect(verdict.status).toBe("suspicious");
    if (verdict.status === "suspicious") {
      expect(verdict.variantKey).toBe("a");
    }
  });

  it("guard-метрика: рост/null подписчиков не мешает победителю", () => {
    const samples = [
      sample("a", MIN_POSTS_PER_VARIANT, 0.1),
      sample("b", MIN_POSTS_PER_VARIANT, 0.07),
    ];
    expect(evaluateExperiment(samples, 5).status).toBe("winner");
    expect(evaluateExperiment(samples, null).status).toBe("winner");
  });

  it("ERR второго = 0, лучшего > 0 → winner с deltaPct null (базы для % нет)", () => {
    const verdict = evaluateExperiment([
      sample("a", MIN_POSTS_PER_VARIANT, 0.1),
      sample("b", MIN_POSTS_PER_VARIANT, 0),
    ]);
    expect(verdict.status).toBe("winner");
    if (verdict.status === "winner") {
      expect(verdict.deltaPct).toBeNull();
    }
  });

  it("оба варианта с нулевым ERR → no_difference", () => {
    const verdict = evaluateExperiment([
      sample("a", MIN_POSTS_PER_VARIANT, 0),
      sample("b", MIN_POSTS_PER_VARIANT, 0),
    ]);
    expect(verdict.status).toBe("no_difference");
  });
});
