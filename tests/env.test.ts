import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";

describe("parseEnv", () => {
  it("падает без BOT_TOKEN", () => {
    expect(() => parseEnv({})).toThrow();
  });

  it("падает на пустом BOT_TOKEN", () => {
    expect(() => parseEnv({ BOT_TOKEN: "" })).toThrow();
  });

  it("проходит с BOT_TOKEN и подставляет дефолты", () => {
    const env = parseEnv({ BOT_TOKEN: "123:abc" });
    expect(env.BOT_TOKEN).toBe("123:abc");
    expect(env.PORT).toBe(8000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("приводит PORT к числу", () => {
    const env = parseEnv({ BOT_TOKEN: "123:abc", PORT: "5000" });
    expect(env.PORT).toBe(5000);
  });

  it("отвергает неизвестный LOG_LEVEL", () => {
    expect(() => parseEnv({ BOT_TOKEN: "123:abc", LOG_LEVEL: "loud" })).toThrow();
  });
});
