import { describe, expect, it } from "vitest";
import {
  matchTrigger,
  normalizeTriggerText,
} from "../src/core/triggers/matchTrigger";
import {
  answerKey,
  pickPredictionNoRepeat,
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

describe("renderTemplate / pickPredictionNoRepeat", () => {
  it("подставляет имя во все вхождения {name}", () => {
    expect(renderTemplate("Привет, {name}! Как ты, {name}?", { name: "@anna" })).toBe(
      "Привет, @anna! Как ты, @anna?",
    );
  });

  it("детерминированный выбор при фиксированном rng (память пуста)", () => {
    const pool = ["{name}: A", "{name}: B", "{name}: C"];
    expect(pickPredictionNoRepeat(pool, [], "@anna", () => 0)?.text).toBe("@anna: A");
    expect(pickPredictionNoRepeat(pool, [], "@anna", () => 0.99)?.text).toBe("@anna: C");
  });

  it("пустой пул → null", () => {
    expect(pickPredictionNoRepeat([], [], "@anna")).toBeNull();
  });

  it("«колода»: за цикл из N розыгрышей ни одного повтора, потом цикл заново", () => {
    const pool = ["A", "B", "C"];
    // rng всегда 0 → берём первого кандидата; исключения двигают «колоду».
    const rng = (): number => 0;
    let recent: string[] = [];
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) {
      const pick = pickPredictionNoRepeat(pool, recent, "x", rng);
      expect(pick).not.toBeNull();
      if (pick === null) return;
      seq.push(pick.text);
      recent = pick.recentKeys;
    }
    // Каждое окно из 3 подряд — все три разные (нет повторов до исчерпания).
    expect(new Set(seq.slice(0, 3)).size).toBe(3);
    expect(new Set(seq.slice(3, 6)).size).toBe(3);
  });

  it("память не длиннее N−1 и переживает сжатие пула", () => {
    const pick = pickPredictionNoRepeat(["A", "B", "C"], ["zzz", "yyy"], "x", () => 0);
    expect(pick).not.toBeNull();
    // Старые «мёртвые» ключи (zzz/yyy не из пула) отброшены, длина ≤ 2.
    expect(pick?.recentKeys.length).toBeLessThanOrEqual(2);
  });

  it("answerKey стабилен и зависит от содержимого", () => {
    expect(answerKey("одинаковый")).toBe(answerKey("одинаковый"));
    expect(answerKey("A")).not.toBe(answerKey("B"));
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
