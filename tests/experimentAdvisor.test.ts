import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import {
  buildAdvisorPrompt,
  parseAdvisorVerdict,
  MAX_RATIONALE_LENGTH,
  type AdvisorPromptInput,
} from "../src/core/experiments/buildAdvisorPrompt";
import {
  generateAdvice,
  type AiTextClient,
} from "../src/services/experiments/experimentAdvisorService";

/** Тихий логгер-заглушка (как в growthNarrative.test.ts). */
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

describe("buildAdvisorPrompt / parseAdvisorVerdict (Шаг 13f)", () => {
  const input: AdvisorPromptInput = {
    channelTitle: "Таро София",
    niche: "эзотерика",
    toneOfVoice: "тёплый, с эмодзи",
    language: "ru",
    factsReport: FACTS,
  };

  it("system несёт каталог измерений, тон, язык, запрет выдумывать; user — факты", () => {
    const { system, user } = buildAdvisorPrompt(input);
    expect(system).toContain("Таро София");
    expect(system).toContain("cta_style");
    expect(system).toContain("media");
    expect(system).toContain("length");
    expect(system).toContain("headline_style");
    expect(system).toContain("тёплый, с эмодзи");
    expect(system).toContain("ru");
    expect(system).toContain("ничего не выдумывай");
    expect(user).toContain("ERR 4.2%");
  });

  it("settledLabels попадают в промпт как «предпочти другое»", () => {
    const { system } = buildAdvisorPrompt({
      ...input,
      settledLabels: ["Стиль CTA", "Длина поста"],
    });
    expect(system).toContain("Уже проверено");
    expect(system).toContain("Стиль CTA");
    expect(system).toContain("Длина поста");
  });

  it("без settledLabels строки «Уже проверено» нет; null tone — не падает", () => {
    const { system } = buildAdvisorPrompt({ ...input, toneOfVoice: null });
    expect(system).not.toContain("Уже проверено");
  });

  it("parseAdvisorVerdict: валидный JSON → вердикт", () => {
    const v = parseAdvisorVerdict(
      '{"dimension":"media","rationale":"Фото заходят лучше — стоит проверить"}',
    );
    expect(v).toEqual({
      dimension: "media",
      rationale: "Фото заходят лучше — стоит проверить",
    });
  });

  it("parseAdvisorVerdict: вычищает Markdown-эмфазу из обоснования", () => {
    const v = parseAdvisorVerdict(
      '{"dimension":"length","rationale":"*Короткие* посты _выигрывают_"}',
    );
    expect(v?.rationale).toBe("Короткие посты выигрывают");
  });

  it("parseAdvisorVerdict: измерение вне каталога → null", () => {
    expect(
      parseAdvisorVerdict('{"dimension":"emoji","rationale":"почему бы и нет"}'),
    ).toBeNull();
  });

  it("parseAdvisorVerdict: пустое обоснование / кривой JSON / перебор длины → null", () => {
    expect(parseAdvisorVerdict('{"dimension":"cta_style","rationale":""}')).toBeNull();
    expect(parseAdvisorVerdict("не json")).toBeNull();
    expect(
      parseAdvisorVerdict(
        `{"dimension":"cta_style","rationale":"${"я".repeat(MAX_RATIONALE_LENGTH + 1)}"}`,
      ),
    ).toBeNull();
  });
});

describe("generateAdvice (фейковый клиент)", () => {
  const input: AdvisorPromptInput = {
    channelTitle: "Канал",
    niche: "новости",
    toneOfVoice: null,
    language: "ru",
    factsReport: FACTS,
  };

  it("валидный JSON от клиента → вердикт", async () => {
    const client: AiTextClient = {
      complete: () =>
        Promise.resolve('{"dimension":"headline_style","rationale":"Заголовки слабые"}'),
    };
    const v = await generateAdvice({ logger: silentLogger, apiKey: "k" }, input, client);
    expect(v).toEqual({ dimension: "headline_style", rationale: "Заголовки слабые" });
  });

  it("нет ключа → null, клиент не вызывается", async () => {
    let called = false;
    const client: AiTextClient = {
      complete: () => {
        called = true;
        return Promise.resolve('{"dimension":"media","rationale":"x"}');
      },
    };
    const v = await generateAdvice(
      { logger: silentLogger, apiKey: undefined },
      input,
      client,
    );
    expect(v).toBeNull();
    expect(called).toBe(false);
  });

  it("кривой ответ модели → null", async () => {
    const client: AiTextClient = { complete: () => Promise.resolve("мусор") };
    const v = await generateAdvice({ logger: silentLogger, apiKey: "k" }, input, client);
    expect(v).toBeNull();
  });

  it("ошибка клиента → null (не бросает)", async () => {
    const client: AiTextClient = {
      complete: () => Promise.reject(new Error("timeout")),
    };
    const v = await generateAdvice({ logger: silentLogger, apiKey: "k" }, input, client);
    expect(v).toBeNull();
  });
});
