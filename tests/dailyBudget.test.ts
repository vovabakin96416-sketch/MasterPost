import { describe, expect, it } from "vitest";
import { consumeDailyBudget } from "../src/core/ai/dailyBudget";

const TODAY = "2026-07-10";
const YESTERDAY = "2026-07-09";

describe("consumeDailyBudget", () => {
  it("нет состояния → разрешает и ставит счётчик 1", () => {
    expect(consumeDailyBudget(null, 5, TODAY)).toEqual({
      allowed: true,
      state: { date: TODAY, count: 1 },
    });
  });

  it("сегодня ещё есть запас → разрешает и инкрементит", () => {
    expect(consumeDailyBudget({ date: TODAY, count: 4 }, 5, TODAY)).toEqual({
      allowed: true,
      state: { date: TODAY, count: 5 },
    });
  });

  it("достигнут потолок → запрещает, счётчик не растёт", () => {
    expect(consumeDailyBudget({ date: TODAY, count: 5 }, 5, TODAY)).toEqual({
      allowed: false,
      state: { date: TODAY, count: 5 },
    });
  });

  it("состояние за вчера → сброс на новый день (count 1)", () => {
    expect(consumeDailyBudget({ date: YESTERDAY, count: 99 }, 5, TODAY)).toEqual({
      allowed: true,
      state: { date: TODAY, count: 1 },
    });
  });

  it("cap 0 → всё запрещено, дата подтягивается к сегодня", () => {
    expect(consumeDailyBudget({ date: YESTERDAY, count: 3 }, 0, TODAY)).toEqual({
      allowed: false,
      state: { date: TODAY, count: 0 },
    });
  });

  it("отрицательный cap → запрещено", () => {
    expect(consumeDailyBudget(null, -1, TODAY).allowed).toBe(false);
  });
});
