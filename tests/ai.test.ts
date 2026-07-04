import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import {
  parsePostDraft,
  parsePostDraftJson,
} from "../src/core/ai/postDraft";
import { buildPostPrompt } from "../src/core/ai/buildPostPrompt";
import {
  generatePostDraft,
  type AiTextClient,
} from "../src/services/ai/aiGenerationService";

/** Тихий логгер-заглушка (как в media.test.ts). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const VALID = { title: "Заголовок", text: "Тело поста", cta: "Подпишись" };

describe("parsePostDraft / parsePostDraftJson", () => {
  it("валидный объект → нормализованный черновик", () => {
    expect(parsePostDraft({ ...VALID, pexelsQuery: "tarot cards" })).toEqual({
      ...VALID,
      pexelsQuery: "tarot cards",
    });
  });

  it("чистая JSON-строка", () => {
    const draft = parsePostDraftJson(JSON.stringify({ ...VALID, pexelsQuery: "moon" }));
    expect(draft).toEqual({ ...VALID, pexelsQuery: "moon" });
  });

  it("JSON в ```json-ограждении", () => {
    const wrapped = "```json\n" + JSON.stringify({ ...VALID, pexelsQuery: "candle" }) + "\n```";
    expect(parsePostDraftJson(wrapped)).toEqual({ ...VALID, pexelsQuery: "candle" });
  });

  it("нет обязательного поля (cta) → бросает", () => {
    expect(() => parsePostDraft({ title: "t", text: "x", pexelsQuery: "q" })).toThrow();
  });

  it("лишний ключ игнорируется", () => {
    expect(parsePostDraft({ ...VALID, pexelsQuery: "q", extra: 42 })).toEqual({
      ...VALID,
      pexelsQuery: "q",
    });
  });

  it("пустой / отсутствующий pexelsQuery → null", () => {
    expect(parsePostDraft({ ...VALID, pexelsQuery: "" }).pexelsQuery).toBeNull();
    expect(parsePostDraft({ ...VALID, pexelsQuery: "   " }).pexelsQuery).toBeNull();
    expect(parsePostDraft(VALID).pexelsQuery).toBeNull();
    expect(parsePostDraft({ ...VALID, pexelsQuery: null }).pexelsQuery).toBeNull();
  });
});

describe("buildPostPrompt", () => {
  const input = {
    channelTitle: "Таро София",
    examples: [
      { title: "Карта дня", text: "Сегодня Луна", cta: "Жми звезду" },
      { title: "Расклад", text: "Три карты на неделю", cta: "Пиши слово" },
    ],
  };

  it("user содержит название канала и каждый пример", () => {
    const { user } = buildPostPrompt(input);
    expect(user).toContain("Таро София");
    expect(user).toContain("Сегодня Луна");
    expect(user).toContain("Три карты на неделю");
  });

  it("system называет JSON-поля черновика", () => {
    const { system } = buildPostPrompt(input);
    for (const field of ["title", "text", "cta", "pexelsQuery"]) {
      expect(system).toContain(field);
    }
  });

  it("тема попадает в user, когда задана", () => {
    const { user } = buildPostPrompt({ ...input, topic: "полнолуние" });
    expect(user).toContain("полнолуние");
  });

  it("без темы — инструкция выбрать самому (нет строки «Тема нового поста»)", () => {
    const { user } = buildPostPrompt(input);
    expect(user).not.toContain("Тема нового поста:");
    expect(user).toContain("Тему выбери сам");
  });
});

describe("generatePostDraft (фейковый клиент)", () => {
  const input = {
    channelTitle: "Канал",
    examples: [{ title: "t", text: "x", cta: "c" }],
  };

  it("канонный JSON от клиента → корректный PostDraft", async () => {
    const client: AiTextClient = {
      complete: () => Promise.resolve(JSON.stringify({ ...VALID, pexelsQuery: "sky" })),
    };
    const draft = await generatePostDraft({ logger: silentLogger, apiKey: "k" }, input, client);
    expect(draft).toEqual({ ...VALID, pexelsQuery: "sky" });
  });

  it("мусор от клиента → null (не бросает)", async () => {
    const client: AiTextClient = { complete: () => Promise.resolve("не json") };
    const draft = await generatePostDraft({ logger: silentLogger, apiKey: "k" }, input, client);
    expect(draft).toBeNull();
  });

  it("нет ключа → null, клиент не вызывается", async () => {
    let called = false;
    const client: AiTextClient = {
      complete: () => {
        called = true;
        return Promise.resolve("{}");
      },
    };
    const draft = await generatePostDraft(
      { logger: silentLogger, apiKey: undefined },
      input,
      client,
    );
    expect(draft).toBeNull();
    expect(called).toBe(false);
  });
});
