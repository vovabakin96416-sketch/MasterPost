import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";

// Минимально валидное окружение для позитивных кейсов.
const base = {
  BOT_TOKEN: "123:abc",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  ADMIN_ID: "7035079048",
};

describe("parseEnv", () => {
  it("падает без BOT_TOKEN", () => {
    expect(() => parseEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow();
  });

  it("падает на пустом BOT_TOKEN", () => {
    expect(() => parseEnv({ ...base, BOT_TOKEN: "" })).toThrow();
  });

  it("падает без DATABASE_URL", () => {
    expect(() => parseEnv({ BOT_TOKEN: base.BOT_TOKEN })).toThrow();
  });

  it("падает без ADMIN_ID", () => {
    expect(() =>
      parseEnv({ BOT_TOKEN: base.BOT_TOKEN, DATABASE_URL: base.DATABASE_URL }),
    ).toThrow();
  });

  it("отвергает нечисловой и неположительный ADMIN_ID", () => {
    expect(() => parseEnv({ ...base, ADMIN_ID: "abc" })).toThrow();
    expect(() => parseEnv({ ...base, ADMIN_ID: "0" })).toThrow();
    expect(() => parseEnv({ ...base, ADMIN_ID: "-5" })).toThrow();
  });

  it("проходит с BOT_TOKEN, DATABASE_URL, ADMIN_ID и подставляет дефолты", () => {
    const env = parseEnv(base);
    expect(env.BOT_TOKEN).toBe("123:abc");
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(env.ADMIN_ID).toBe(7035079048);
    expect(env.PORT).toBe(8000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("приводит PORT к числу", () => {
    const env = parseEnv({ ...base, PORT: "5000" });
    expect(env.PORT).toBe(5000);
  });

  it("отвергает неизвестный LOG_LEVEL", () => {
    expect(() => parseEnv({ ...base, LOG_LEVEL: "loud" })).toThrow();
  });
});
