import { describe, expect, it } from "vitest";
import {
  cbByteLength,
  CB_MAX_BYTES,
  decodeCb,
  encodeCb,
  intArg,
} from "../src/core/menu/callbackData";
import { paginate } from "../src/core/menu/paginate";
import {
  MAX_ANSWER_LENGTH,
  validateAnswer,
  validateTriggerWord,
} from "../src/core/menu/validation";

describe("callbackData: encode/decode round-trip", () => {
  it("кодирует и декодирует действие с аргументами", () => {
    const data = encodeCb("tw", 3, 0);
    expect(data).toBe("m:tw:3:0");
    const parsed = decodeCb(data);
    expect(parsed).toEqual({ action: "tw", args: ["3", "0"] });
  });

  it("действие без аргументов", () => {
    expect(decodeCb(encodeCb("home"))).toEqual({ action: "home", args: [] });
  });

  it("чужой/битый префикс → null", () => {
    expect(decodeCb("x:home")).toBeNull();
    expect(decodeCb("home")).toBeNull();
    expect(decodeCb("")).toBeNull();
    expect(decodeCb("m:")).toBeNull();
  });

  it("intArg парсит неотрицательные целые, иначе null", () => {
    const { args } = decodeCb("m:tw:3:-1:abc") ?? { args: [] };
    expect(intArg(args, 0)).toBe(3);
    expect(intArg(args, 1)).toBeNull(); // -1
    expect(intArg(args, 2)).toBeNull(); // abc
    expect(intArg(args, 5)).toBeNull(); // вне диапазона
  });

  it("типичные callback'и помещаются в лимит 64 байта", () => {
    for (const data of [
      encodeCb("home"),
      encodeCb("trg", 99),
      encodeCb("tw", 999, 99),
      encodeCb("ans", 999, 999),
      encodeCb("edita", 999, 999),
      encodeCb("tgl", "comments"),
    ]) {
      expect(cbByteLength(data)).toBeLessThanOrEqual(CB_MAX_BYTES);
    }
  });
});

describe("paginate", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("первая страница", () => {
    const pg = paginate(items, 0, 4);
    expect(pg.slice).toEqual([0, 1, 2, 3]);
    expect(pg.page).toBe(0);
    expect(pg.totalPages).toBe(3);
    expect(pg.hasPrev).toBe(false);
    expect(pg.hasNext).toBe(true);
  });

  it("последняя (неполная) страница", () => {
    const pg = paginate(items, 2, 4);
    expect(pg.slice).toEqual([8, 9]);
    expect(pg.hasPrev).toBe(true);
    expect(pg.hasNext).toBe(false);
  });

  it("номер страницы зажимается в диапазон", () => {
    expect(paginate(items, 99, 4).page).toBe(2);
    expect(paginate(items, -5, 4).page).toBe(0);
  });

  it("пустой список → одна пустая страница", () => {
    const pg = paginate([], 0, 4);
    expect(pg.slice).toEqual([]);
    expect(pg.totalPages).toBe(1);
    expect(pg.hasPrev).toBe(false);
    expect(pg.hasNext).toBe(false);
  });

  it("список меньше страницы — одна страница без навигации", () => {
    const pg = paginate([1, 2], 0, 8);
    expect(pg.slice).toEqual([1, 2]);
    expect(pg.totalPages).toBe(1);
    expect(pg.hasNext).toBe(false);
  });
});

describe("validateAnswer", () => {
  it("пустое/из пробелов → ошибка", () => {
    expect(validateAnswer("").ok).toBe(false);
    expect(validateAnswer("   ").ok).toBe(false);
  });

  it("слишком длинное → ошибка", () => {
    expect(validateAnswer("x".repeat(MAX_ANSWER_LENGTH + 1)).ok).toBe(false);
  });

  it("нормальное → ок, обрезает по краям", () => {
    const r = validateAnswer("  Привет, {name}!  ");
    expect(r).toEqual({ ok: true, value: "Привет, {name}!" });
  });
});

describe("validateTriggerWord (дедуп через нормализацию)", () => {
  const existing = ["карта", "кофе"];

  it("новое слово → ок", () => {
    expect(validateTriggerWord("звезда", existing)).toEqual({
      ok: true,
      value: "звезда",
    });
  });

  it("дубль (с учётом регистра/растяжки/ё) → ошибка", () => {
    expect(validateTriggerWord("КАРТА", existing).ok).toBe(false);
    expect(validateTriggerWord("кааарта", existing).ok).toBe(false);
    expect(validateTriggerWord("кофё", existing).ok).toBe(false);
  });

  it("пустое / только знаки → ошибка", () => {
    expect(validateTriggerWord("   ", existing).ok).toBe(false);
    expect(validateTriggerWord("!!! …", existing).ok).toBe(false);
  });
});
