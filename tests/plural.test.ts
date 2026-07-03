import { describe, expect, it } from "vitest";
import { pluralRu, type PluralForms } from "../src/core/text/pluralRu";

const ANSWERS: PluralForms = ["ответ", "ответа", "ответов"];
const DAYS: PluralForms = ["день", "дня", "дней"];

describe("pluralRu", () => {
  it("форма «один»: 1, 21, 101 (но не 11)", () => {
    expect(pluralRu(1, ANSWERS)).toBe("ответ");
    expect(pluralRu(21, ANSWERS)).toBe("ответ");
    expect(pluralRu(101, ANSWERS)).toBe("ответ");
  });

  it("форма «несколько»: 2–4, 22–24, 104 (но не 12–14)", () => {
    expect(pluralRu(2, ANSWERS)).toBe("ответа");
    expect(pluralRu(4, ANSWERS)).toBe("ответа");
    expect(pluralRu(23, ANSWERS)).toBe("ответа");
    expect(pluralRu(104, ANSWERS)).toBe("ответа");
  });

  it("форма «много»: 0, 5–20, 11–14, 111", () => {
    expect(pluralRu(0, ANSWERS)).toBe("ответов");
    expect(pluralRu(5, ANSWERS)).toBe("ответов");
    expect(pluralRu(11, ANSWERS)).toBe("ответов");
    expect(pluralRu(14, ANSWERS)).toBe("ответов");
    expect(pluralRu(19, ANSWERS)).toBe("ответов");
    expect(pluralRu(111, ANSWERS)).toBe("ответов");
  });

  it("работает с любым набором форм", () => {
    expect(pluralRu(1, DAYS)).toBe("день");
    expect(pluralRu(3, DAYS)).toBe("дня");
    expect(pluralRu(12, DAYS)).toBe("дней");
  });
});
