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
  canRevokeOwner,
  REVOKE_DENIED_NOT_ADMIN,
  REVOKE_DENIED_SELF,
} from "../src/core/menu/ownerAccess";
import {
  MAX_ANSWER_LENGTH,
  MAX_DAILY_CAP,
  MAX_OWNER_NAME_LENGTH,
  POST_FIELD_LIMITS,
  validateAnswer,
  validateDailyCap,
  validateOwnerInvite,
  validatePostField,
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
      encodeCb("pw", 99, 99),
      encodeCb("pp", 999),
      encodeCb("ped", 2, 999),
      encodeCb("pdel", 999),
      encodeCb("bpo", 99, 99),
      encodeCb("bia", 99, 999),
      encodeCb("bea", 99, 999),
      encodeCb("bda", 99, 999),
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

describe("validatePostField (лимиты по полю)", () => {
  it("пустое/из пробелов → ошибка для любого поля", () => {
    expect(validatePostField("", "title").ok).toBe(false);
    expect(validatePostField("   ", "text").ok).toBe(false);
    expect(validatePostField("\n\t", "cta").ok).toBe(false);
  });

  it("нормальное → ок, обрезает по краям", () => {
    expect(validatePostField("  Новый заголовок  ", "title")).toEqual({
      ok: true,
      value: "Новый заголовок",
    });
  });

  it("превышение лимита поля → ошибка", () => {
    expect(validatePostField("x".repeat(POST_FIELD_LIMITS.title + 1), "title").ok).toBe(
      false,
    );
    expect(validatePostField("x".repeat(POST_FIELD_LIMITS.cta + 1), "cta").ok).toBe(false);
    expect(validatePostField("x".repeat(POST_FIELD_LIMITS.text + 1), "text").ok).toBe(
      false,
    );
  });

  it("на границе лимита поля → ок", () => {
    expect(validatePostField("x".repeat(POST_FIELD_LIMITS.title), "title").ok).toBe(true);
  });

  it("у text лимит больше, чем у title", () => {
    const between = "x".repeat(POST_FIELD_LIMITS.title + 50);
    expect(validatePostField(between, "title").ok).toBe(false);
    expect(validatePostField(between, "text").ok).toBe(true);
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

describe("validateDailyCap (дневной лимит AI-вызовов)", () => {
  it("целое в диапазоне → ок (0 разрешён = отключить)", () => {
    expect(validateDailyCap("50")).toEqual({ ok: true, value: 50 });
    expect(validateDailyCap("0")).toEqual({ ok: true, value: 0 });
    expect(validateDailyCap(` ${String(MAX_DAILY_CAP)} `)).toEqual({
      ok: true,
      value: MAX_DAILY_CAP,
    });
  });

  it("не число / отрицательное / выше потолка → ошибка", () => {
    expect(validateDailyCap("abc").ok).toBe(false);
    expect(validateDailyCap("-5").ok).toBe(false);
    expect(validateDailyCap("1.5").ok).toBe(false);
    expect(validateDailyCap(String(MAX_DAILY_CAP + 1)).ok).toBe(false);
  });
});

describe("validateOwnerInvite (приглашение владельца, Шаг 14b-1)", () => {
  it("голый id → owner без имени", () => {
    expect(validateOwnerInvite(" 123456789 ")).toEqual({
      ok: true,
      value: { telegramUserId: 123456789, name: null },
    });
  });

  it("id + имя (в т.ч. из нескольких слов) → имя сохраняется", () => {
    expect(validateOwnerInvite("123456789 Анна")).toEqual({
      ok: true,
      value: { telegramUserId: 123456789, name: "Анна" },
    });
    expect(validateOwnerInvite("42 Анна Тестер")).toEqual({
      ok: true,
      value: { telegramUserId: 42, name: "Анна Тестер" },
    });
  });

  it("не число / пусто / ноль / имя впереди → ошибка", () => {
    expect(validateOwnerInvite("").ok).toBe(false);
    expect(validateOwnerInvite("abc").ok).toBe(false);
    expect(validateOwnerInvite("0").ok).toBe(false);
    expect(validateOwnerInvite("-5").ok).toBe(false);
    expect(validateOwnerInvite("Анна 123456789").ok).toBe(false);
    expect(validateOwnerInvite("@username").ok).toBe(false);
  });

  it("слишком длинный id или имя → ошибка", () => {
    expect(validateOwnerInvite("1".repeat(16)).ok).toBe(false);
    expect(
      validateOwnerInvite(`123 ${"а".repeat(MAX_OWNER_NAME_LENGTH + 1)}`).ok,
    ).toBe(false);
  });
});

describe("canRevokeOwner (отзыв доступа, Шаг 14b-4)", () => {
  const adminId = 7035079048;

  it("супервладелец отзывает доступ у постороннего владельца", () => {
    expect(
      canRevokeOwner({
        viewerUserId: adminId,
        adminId,
        targetTelegramUserId: "123456789",
      }),
    ).toEqual({ ok: true });
  });

  it("не супервладелец не управляет доступом (крафтнутый callback)", () => {
    expect(
      canRevokeOwner({
        viewerUserId: 123456789,
        adminId,
        targetTelegramUserId: "555",
      }),
    ).toEqual({ ok: false, error: REVOKE_DENIED_NOT_ADMIN });
  });

  it("супервладельца (себя) отозвать нельзя — бот останется без хозяина", () => {
    expect(
      canRevokeOwner({
        viewerUserId: adminId,
        adminId,
        targetTelegramUserId: String(adminId),
      }),
    ).toEqual({ ok: false, error: REVOKE_DENIED_SELF });
    // id в БД хранится строкой — пробелы вокруг не должны обходить запрет
    expect(
      canRevokeOwner({
        viewerUserId: adminId,
        adminId,
        targetTelegramUserId: ` ${String(adminId)} `,
      }).ok,
    ).toBe(false);
  });
});
