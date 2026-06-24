import { describe, it, expect } from "vitest";
import { localDateParts } from "../src/core/schedule/localDate.js";
import { resolveCampaignDay } from "../src/core/schedule/resolveCampaignDay.js";
import { dueSlots, parseTime } from "../src/core/schedule/dueSlots.js";
import { validateTime } from "../src/core/menu/validation.js";

/** Хелпер: локальные части UTC-инстанта в UTC (детерминированно для тестов). */
function at(iso: string): ReturnType<typeof localDateParts> {
  return localDateParts(new Date(iso), "UTC");
}

describe("localDateParts", () => {
  it("раскладывает дату/время в указанном поясе", () => {
    const p = localDateParts(new Date("2024-01-01T05:00:00Z"), "UTC");
    expect(p).toMatchObject({
      year: 2024,
      month: 1,
      day: 1,
      weekday: "monday", // 2024-01-01 — понедельник
      isoDate: "2024-01-01",
      hour: 5,
      minute: 0,
    });
  });

  it("учитывает переход суток по часовому поясу (МСК = UTC+3)", () => {
    // 21:30 UTC → 00:30 следующего дня в Москве.
    const p = localDateParts(new Date("2024-01-01T21:30:00Z"), "Europe/Moscow");
    expect(p.isoDate).toBe("2024-01-02");
    expect(p.weekday).toBe("tuesday");
    expect(p.hour).toBe(0);
    expect(p.minute).toBe(30);
  });
});

describe("resolveCampaignDay", () => {
  it("start=null → неделя 1, день из сегодня", () => {
    expect(resolveCampaignDay(at("2024-01-03T00:00:00Z"), null)).toEqual({
      week: 1,
      day: "wednesday",
    });
  });

  it("недели идут по кругу 1→2→3→4→1", () => {
    const start = at("2024-01-01T00:00:00Z"); // понедельник
    expect(resolveCampaignDay(at("2024-01-01T00:00:00Z"), start).week).toBe(1);
    expect(resolveCampaignDay(at("2024-01-08T00:00:00Z"), start).week).toBe(2);
    expect(resolveCampaignDay(at("2024-01-15T00:00:00Z"), start).week).toBe(3);
    expect(resolveCampaignDay(at("2024-01-22T00:00:00Z"), start).week).toBe(4);
    expect(resolveCampaignDay(at("2024-01-29T00:00:00Z"), start).week).toBe(1);
  });

  it("середина недели остаётся в той же неделе", () => {
    const start = at("2024-01-01T00:00:00Z");
    // +10 дней → всё ещё неделя 2 (дни 7..13).
    expect(resolveCampaignDay(at("2024-01-11T00:00:00Z"), start).week).toBe(2);
  });

  it("старт в будущем трактуется как неделя 1", () => {
    const start = at("2024-02-01T00:00:00Z");
    expect(resolveCampaignDay(at("2024-01-01T00:00:00Z"), start).week).toBe(1);
  });
});

describe("dueSlots", () => {
  const schedule = { morning: "10:00", evening: "20:00" };
  const none = { morning: null, evening: null };

  it("до времени слота — пусто", () => {
    expect(dueSlots(at("2024-01-01T09:00:00Z"), schedule, none)).toEqual([]);
  });

  it("после времени слота — слот «пора»", () => {
    expect(dueSlots(at("2024-01-01T10:30:00Z"), schedule, none)).toEqual([
      "morning",
    ]);
  });

  it("оба слота после своего времени", () => {
    expect(dueSlots(at("2024-01-01T20:01:00Z"), schedule, none)).toEqual([
      "morning",
      "evening",
    ]);
  });

  it("уже публиковали сегодня — слот не повторяется (дедуп)", () => {
    const last = { morning: "2024-01-01", evening: null };
    expect(dueSlots(at("2024-01-01T10:30:00Z"), schedule, last)).toEqual([]);
  });

  it("публиковали вчера — слот снова «пора» сегодня", () => {
    const last = { morning: "2023-12-31", evening: null };
    expect(dueSlots(at("2024-01-01T10:30:00Z"), schedule, last)).toEqual([
      "morning",
    ]);
  });

  it("догон после простоя: время давно прошло, сегодня не постили", () => {
    expect(dueSlots(at("2024-01-01T23:00:00Z"), schedule, none)).toEqual([
      "morning",
      "evening",
    ]);
  });

  it("невалидное время слота тихо пропускается", () => {
    const bad = { morning: "25:00", evening: "20:00" };
    expect(dueSlots(at("2024-01-01T23:00:00Z"), bad, none)).toEqual(["evening"]);
  });
});

describe("parseTime / validateTime", () => {
  it("parseTime парсит валидные значения", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("10:00")).toBe(600);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime(" 9:05 ")).toBe(545);
  });

  it("parseTime отвергает мусор", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("10:60")).toBeNull();
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("10")).toBeNull();
  });

  it("validateTime нормализует ведущий ноль в часах", () => {
    const r = validateTime("9:05");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("09:05");
    }
  });

  it("validateTime возвращает ошибку на кривой ввод", () => {
    expect(validateTime("99:99").ok).toBe(false);
  });
});
