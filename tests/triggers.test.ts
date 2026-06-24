import { describe, expect, it } from "vitest";
import {
  matchTrigger,
  normalizeTriggerText,
} from "../src/core/triggers/matchTrigger";
import {
  pickPrediction,
  renderTemplate,
} from "../src/core/triggers/pickPrediction";
import { isOnCooldown, nextExpiry } from "../src/core/triggers/cooldown";

// Слова канала №1 (таро) — но в код не зашиты: приходят как данные.
const taroWords = ["карта", "кофе", "руна"];

describe("matchTrigger (слова из конфига канала)", () => {
  it("матчит точное слово", () => {
    expect(matchTrigger("карта", taroWords)).toBe("карта");
    expect(matchTrigger("кофе", taroWords)).toBe("кофе");
    expect(matchTrigger("руна", taroWords)).toBe("руна");
  });

  it("игнорирует регистр, знаки препинания и пробелы по краям", () => {
    expect(matchTrigger("КАРТА!", taroWords)).toBe("карта");
    expect(matchTrigger("  кофе…  ", taroWords)).toBe("кофе");
    expect(matchTrigger("Руна.", taroWords)).toBe("руна");
  });

  it("схлопывает растянутые буквы (кааарта → карта)", () => {
    expect(matchTrigger("кааарта", taroWords)).toBe("карта");
    expect(matchTrigger("кооофе", taroWords)).toBe("кофе");
  });

  it("приравнивает ё к е", () => {
    expect(matchTrigger("кофё", taroWords)).toBe("кофе");
  });

  it("не матчит мусор, пустое и чужие слова", () => {
    expect(matchTrigger("привет", taroWords)).toBeNull();
    expect(matchTrigger("", taroWords)).toBeNull();
    expect(matchTrigger("   ", taroWords)).toBeNull();
    expect(matchTrigger("карта дня пожалуйста", taroWords)).toBeNull();
  });

  it("работает с произвольным списком слов (настраиваемость под канал)", () => {
    const newsWords = ["гороскоп", "погода"];
    expect(matchTrigger("Погода?", newsWords)).toBe("погода");
    expect(matchTrigger("карта", newsWords)).toBeNull();
  });

  it("normalizeTriggerText — каноничная форма", () => {
    expect(normalizeTriggerText("  КАаРТА!! ")).toBe("карта");
  });
});

describe("renderTemplate / pickPrediction", () => {
  it("подставляет имя во все вхождения {name}", () => {
    expect(renderTemplate("Привет, {name}! Как ты, {name}?", { name: "@anna" })).toBe(
      "Привет, @anna! Как ты, @anna?",
    );
  });

  it("детерминированный выбор при фиксированном rng", () => {
    const pool = ["{name}: A", "{name}: B", "{name}: C"];
    expect(pickPrediction(pool, "@anna", () => 0)).toBe("@anna: A");
    expect(pickPrediction(pool, "@anna", () => 0.99)).toBe("@anna: C");
    expect(pickPrediction(pool, "@anna", () => 0.5)).toBe("@anna: B");
  });

  it("пустой пул → null", () => {
    expect(pickPrediction([], "@anna")).toBeNull();
  });
});

describe("cooldown (time-математика)", () => {
  const now = new Date("2026-06-24T12:00:00.000Z");

  it("nextExpiry прибавляет часы", () => {
    expect(nextExpiry(now, 24).toISOString()).toBe("2026-06-25T12:00:00.000Z");
  });

  it("isOnCooldown: будущий срок → активен, прошедший/равный → нет", () => {
    expect(isOnCooldown(new Date("2026-06-24T13:00:00.000Z"), now)).toBe(true);
    expect(isOnCooldown(new Date("2026-06-24T11:00:00.000Z"), now)).toBe(false);
    expect(isOnCooldown(now, now)).toBe(false);
  });
});
