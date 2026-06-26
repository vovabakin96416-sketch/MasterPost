import { describe, expect, it } from "vitest";
import { isMtprotoConfigured } from "../src/services/analytics/mtprotoConfig.js";

describe("isMtprotoConfigured", () => {
  it("пустой конфиг → не настроен", () => {
    expect(isMtprotoConfigured({})).toBe(false);
  });

  it("частичный конфиг (2 из 3) → не настроен", () => {
    expect(isMtprotoConfigured({ apiId: 123, apiHash: "abc" })).toBe(false);
    expect(isMtprotoConfigured({ apiHash: "abc", session: "sess" })).toBe(false);
    expect(isMtprotoConfigured({ apiId: 123, session: "sess" })).toBe(false);
  });

  it("пустые строки считаются отсутствующими", () => {
    expect(
      isMtprotoConfigured({ apiId: 123, apiHash: "", session: "sess" }),
    ).toBe(false);
    expect(
      isMtprotoConfigured({ apiId: 123, apiHash: "abc", session: "" }),
    ).toBe(false);
  });

  it("все три заданы → настроен", () => {
    expect(
      isMtprotoConfigured({ apiId: 123, apiHash: "abc", session: "sess" }),
    ).toBe(true);
  });
});
