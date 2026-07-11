import { describe, expect, it } from "vitest";
import {
  parseTopHoursGraph,
  rankTopHours,
} from "../src/core/analytics/topHours";

// Мини-граф в формате Telegram (DataJSON.data). Часы 0..3, значения — активность.
function graph(x: unknown[], y: unknown[]): string {
  return JSON.stringify({
    columns: [
      ["x", ...x],
      ["y0", ...y],
    ],
    types: { x: "line", y0: "line" },
    names: { y0: "Views" },
  });
}

describe("parseTopHoursGraph", () => {
  it("сшивает часы и значения по индексу", () => {
    const hours = parseTopHoursGraph(graph([0, 1, 2, 3], [10, 40, 5, 20]));
    expect(hours).toEqual([
      { hour: 0, value: 10 },
      { hour: 1, value: 40 },
      { hour: 2, value: 5 },
      { hour: 3, value: 20 },
    ]);
  });

  it("битый JSON → пустой список", () => {
    expect(parseTopHoursGraph("{not json")).toEqual([]);
    expect(parseTopHoursGraph("")).toEqual([]);
  });

  it("нет колонок x/y → пустой список", () => {
    expect(parseTopHoursGraph(JSON.stringify({ columns: [] }))).toEqual([]);
    expect(
      parseTopHoursGraph(JSON.stringify({ columns: [["y0", 1, 2]] })),
    ).toEqual([]);
  });

  it("час вне 0..23 или нечисловое значение — пропускаем", () => {
    const hours = parseTopHoursGraph(graph([0, 24, 2], [10, 99, "x"]));
    expect(hours).toEqual([{ hour: 0, value: 10 }]);
  });

  it("разная длина колонок — сшиваем по минимуму (лишний час без значения отброшен)", () => {
    const hours = parseTopHoursGraph(graph([0, 1, 2], [10, 20]));
    expect(hours).toEqual([
      { hour: 0, value: 10 },
      { hour: 1, value: 20 },
    ]);
  });

  it("берёт первую y-колонку, если их несколько", () => {
    const json = JSON.stringify({
      columns: [
        ["x", 0, 1],
        ["y0", 5, 7],
        ["y1", 100, 200],
      ],
    });
    expect(parseTopHoursGraph(json)).toEqual([
      { hour: 0, value: 5 },
      { hour: 1, value: 7 },
    ]);
  });
});

describe("rankTopHours", () => {
  it("сортирует по убыванию активности, лучший час — первым", () => {
    const ranked = rankTopHours(graph([0, 1, 2, 3], [10, 40, 5, 20]));
    expect(ranked.map((h) => h.hour)).toEqual([1, 3, 0, 2]);
  });

  it("при равной активности — по возрастанию часа (детерминизм)", () => {
    const ranked = rankTopHours(graph([5, 2, 9], [50, 50, 50]));
    expect(ranked.map((h) => h.hour)).toEqual([2, 5, 9]);
  });

  it("пустой граф → пустой список", () => {
    expect(rankTopHours("nope")).toEqual([]);
  });
});
