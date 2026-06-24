import { describe, expect, it } from "vitest";
import {
  MIN_ANSWERS,
  STALE_DAYS,
  poolAgeDays,
  poolHealth,
} from "../src/core/content/poolHealth";

const now = new Date("2026-06-24T12:00:00.000Z");
const daysAgo = (n: number): Date =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("poolAgeDays", () => {
  it("считает полный возраст в днях, null если даты нет", () => {
    expect(poolAgeDays(daysAgo(10), now)).toBe(10);
    expect(poolAgeDays(now, now)).toBe(0);
    expect(poolAgeDays(null, now)).toBeNull();
  });
});

describe("poolHealth", () => {
  it("мало ответов → stale/few (даже если свежий)", () => {
    const h = poolHealth(MIN_ANSWERS - 1, daysAgo(1), now);
    expect(h.stale).toBe(true);
    expect(h.reason).toBe("few");
  });

  it("давно не обновляли → stale/old", () => {
    const h = poolHealth(MIN_ANSWERS + 2, daysAgo(STALE_DAYS + 1), now);
    expect(h.stale).toBe(true);
    expect(h.reason).toBe("old");
  });

  it("достаточно ответов и свежий → не stale", () => {
    const h = poolHealth(MIN_ANSWERS + 2, daysAgo(10), now);
    expect(h.stale).toBe(false);
    expect(h.reason).toBeNull();
  });

  it("граница STALE_DAYS: ровно порог — ещё ок, +1 — old", () => {
    expect(poolHealth(MIN_ANSWERS, daysAgo(STALE_DAYS), now).stale).toBe(false);
    expect(poolHealth(MIN_ANSWERS, daysAgo(STALE_DAYS + 1), now).reason).toBe("old");
  });

  it("без даты пула: по «old» не штрафуем, только по «few»", () => {
    expect(poolHealth(MIN_ANSWERS, null, now).stale).toBe(false);
    expect(poolHealth(MIN_ANSWERS - 1, null, now).reason).toBe("few");
  });
});
