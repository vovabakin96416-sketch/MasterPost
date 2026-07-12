import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import {
  buildGrowthNarrativePrompt,
  parseNarrative,
  MAX_NARRATIVE_LENGTH,
  type GrowthNarrativePromptInput,
} from "../src/core/ai/buildGrowthNarrativePrompt";
import {
  generateGrowthNarrative,
  type AiTextClient,
} from "../src/services/ai/growthNarrativeService";

/** Тихий логгер-заглушка (как в aiReply.test.ts). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const FACTS = [
  "🔥 Что зашло: пост «Карта дня» — ERR 4.2%",
  "🕐 Лучшее время: ПТ утро",
  "📈 Тренд: просмотры +12% неделя к неделе",
].join("\n");

describe("buildGrowthNarrativePrompt / parseNarrative (Шаг 12d)", () => {
  const input: GrowthNarrativePromptInput = {
    channelTitle: "Таро София",
    niche: "эзотерика",
    toneOfVoice: "тёплый, поддерживающий, с эмодзи",
    language: "ru",
    factsReport: FACTS,
  };

  it("system несёт название, нишу, тон, язык и запрет выдумывать; user — факты", () => {
    const { system, user } = buildGrowthNarrativePrompt(input);
    expect(system).toContain("Таро София");
    expect(system).toContain("эзотерика");
    expect(system).toContain("тёплый, поддерживающий");
    expect(system).toContain("ru");
    expect(system).toContain("ничего не выдумывай");
    expect(user).toContain("ERR 4.2%");
    expect(user).toContain("ПТ утро");
  });

  it("без toneOfVoice — дефолтная строка тона (не падает на null)", () => {
    const { system } = buildGrowthNarrativePrompt({ ...input, toneOfVoice: null });
    expect(system).toContain("дружелюбный");
  });

  it("parseNarrative: trim валидного текста", () => {
    expect(parseNarrative("  Неделя удалась ✨  ")).toBe("Неделя удалась ✨");
  });

  it("parseNarrative: вычищает Markdown-эмфазу (* и _)", () => {
    expect(parseNarrative("Пост *Карта дня* — _огонь_!")).toBe(
      "Пост Карта дня — огонь!",
    );
  });

  it("parseNarrative: пусто/пробелы/одна эмфаза → null", () => {
    expect(parseNarrative("")).toBeNull();
    expect(parseNarrative("   ")).toBeNull();
    expect(parseNarrative(" ** ")).toBeNull();
  });

  it("parseNarrative: превышение лимита → null", () => {
    expect(parseNarrative("я".repeat(MAX_NARRATIVE_LENGTH + 1))).toBeNull();
    expect(parseNarrative("я".repeat(MAX_NARRATIVE_LENGTH))).not.toBeNull();
  });
});

describe("generateGrowthNarrative (фейковый клиент)", () => {
  const input: GrowthNarrativePromptInput = {
    channelTitle: "Канал",
    niche: "новости",
    toneOfVoice: null,
    language: "ru",
    factsReport: FACTS,
  };

  it("валидный текст от клиента → обрезанная строка", async () => {
    const client: AiTextClient = {
      complete: () => Promise.resolve("  Неделя огонь: пятница утром — наше время! 🚀 "),
    };
    const text = await generateGrowthNarrative(
      { logger: silentLogger, apiKey: "k" },
      input,
      client,
    );
    expect(text).toBe("Неделя огонь: пятница утром — наше время! 🚀");
  });

  it("нет ключа → null, клиент не вызывается", async () => {
    let called = false;
    const client: AiTextClient = {
      complete: () => {
        called = true;
        return Promise.resolve("текст");
      },
    };
    const text = await generateGrowthNarrative(
      { logger: silentLogger, apiKey: undefined },
      input,
      client,
    );
    expect(text).toBeNull();
    expect(called).toBe(false);
  });

  it("пустой ответ модели → null (фолбэк на эвристику у вызывающего)", async () => {
    const client: AiTextClient = { complete: () => Promise.resolve("   ") };
    const text = await generateGrowthNarrative(
      { logger: silentLogger, apiKey: "k" },
      input,
      client,
    );
    expect(text).toBeNull();
  });

  it("ошибка клиента → null (не бросает)", async () => {
    const client: AiTextClient = {
      complete: () => Promise.reject(new Error("timeout")),
    };
    const text = await generateGrowthNarrative(
      { logger: silentLogger, apiKey: "k" },
      input,
      client,
    );
    expect(text).toBeNull();
  });
});
