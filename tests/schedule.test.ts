import { describe, it, expect } from "vitest";
import { localDateParts } from "../src/core/schedule/localDate.js";
import { resolveCampaignDay } from "../src/core/schedule/resolveCampaignDay.js";
import { dueTimes, parseTime, sortTimes } from "../src/core/schedule/times.js";
import {
  validateChannelTarget,
  validateTime,
} from "../src/core/menu/validation.js";

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

describe("sortTimes", () => {
  it("сортирует по возрастанию, убирает дубли и мусор", () => {
    expect(sortTimes(["20:00", "09:00", "20:00", "abc", "13:30"])).toEqual([
      "09:00",
      "13:30",
      "20:00",
    ]);
  });
});

describe("dueTimes", () => {
  const times = ["10:00", "14:00", "20:00"];
  const fresh = { date: null, postedTimes: [] };

  it("до первого времени — пусто", () => {
    expect(dueTimes(at("2024-01-01T09:00:00Z"), times, fresh)).toEqual([]);
  });

  it("наступившие времена «пора» (отсортированы)", () => {
    expect(dueTimes(at("2024-01-01T14:30:00Z"), times, fresh)).toEqual([
      "10:00",
      "14:00",
    ]);
  });

  it("уже отработанные сегодня времена исключаются (дедуп)", () => {
    const progress = { date: "2024-01-01", postedTimes: ["10:00"] };
    expect(dueTimes(at("2024-01-01T14:30:00Z"), times, progress)).toEqual([
      "14:00",
    ]);
  });

  it("прогресс за другой день сбрасывается", () => {
    const progress = { date: "2023-12-31", postedTimes: ["10:00", "14:00"] };
    expect(dueTimes(at("2024-01-01T14:30:00Z"), times, progress)).toEqual([
      "10:00",
      "14:00",
    ]);
  });

  it("догон после простоя: все наступившие времена «пора»", () => {
    expect(dueTimes(at("2024-01-01T23:00:00Z"), times, fresh)).toEqual([
      "10:00",
      "14:00",
      "20:00",
    ]);
  });

  it("пустой список времён → пусто", () => {
    expect(dueTimes(at("2024-01-01T23:00:00Z"), [], fresh)).toEqual([]);
  });
});

describe("validateChannelTarget", () => {
  it("принимает @username", () => {
    const r = validateChannelTarget("@supertestmaster");
    expect(r).toEqual({ ok: true, value: "@supertestmaster" });
  });

  it("принимает голый username и добавляет @", () => {
    const r = validateChannelTarget("supertestmaster");
    expect(r).toEqual({ ok: true, value: "@supertestmaster" });
  });

  it("извлекает username из ссылки t.me", () => {
    const r = validateChannelTarget("https://t.me/supertestmaster");
    expect(r).toEqual({ ok: true, value: "@supertestmaster" });
  });

  it("принимает числовой id канала", () => {
    const r = validateChannelTarget("-1001234567890");
    expect(r).toEqual({ ok: true, value: "-1001234567890" });
  });

  it("отвергает мусор", () => {
    expect(validateChannelTarget("").ok).toBe(false);
    expect(validateChannelTarget("@a").ok).toBe(false);
    expect(validateChannelTarget("привет!").ok).toBe(false);
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
