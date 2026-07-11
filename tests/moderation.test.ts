import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import { detectSpam } from "../src/core/moderation/detectSpam";
import {
  buildToxicityPrompt,
  parseToxicityVerdict,
  shouldCheckToxicity,
  type ToxicityPromptInput,
} from "../src/core/moderation/buildToxicityPrompt";
import {
  classifyToxicity,
  type AiTextClient,
} from "../src/services/moderation/toxicityService";

// Контекст обычного (не привилегированного) отправителя.
const commenter = { isPrivileged: false } as const;

/** Тихий логгер-заглушка (как в aiReply.test.ts). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

/** Фейк-клиент: всегда возвращает заданную строку (JSON вердикта). */
const fakeClient = (reply: string): AiTextClient => ({
  complete: () => Promise.resolve(reply),
});

const toxInput: ToxicityPromptInput = {
  channelTitle: "София Гадалка",
  niche: "таро и эзотерика",
  toneOfVoice: "тёплый, поддерживающий",
  language: "ru",
  comment: "автор — шарлатанка, разводит на деньги",
};

describe("detectSpam — эвристики спама в комментах", () => {
  describe("ссылки (link)", () => {
    it("http(s)-ссылка → спам", () => {
      expect(detectSpam({ text: "смотри тут https://casino.win", ...commenter })).toEqual({
        spam: true,
        reason: "link",
      });
    });

    it("t.me-ссылка → спам", () => {
      expect(detectSpam({ text: "переходи t.me/levый_канал", ...commenter })).toEqual({
        spam: true,
        reason: "link",
      });
    });

    it("голый домен из спамной зоны → спам", () => {
      expect(detectSpam({ text: "заработок на bestcasino.top каждый день", ...commenter })).toEqual({
        spam: true,
        reason: "link",
      });
    });

    it("www-ссылка → спам", () => {
      expect(detectSpam({ text: "жми www.zarabotok.online", ...commenter })).toEqual({
        spam: true,
        reason: "link",
      });
    });
  });

  describe("флуд @-упоминаний (mentions)", () => {
    it("три и более упоминания → спам", () => {
      expect(detectSpam({ text: "@vasya @petya @kolya налетай", ...commenter })).toEqual({
        spam: true,
        reason: "mentions",
      });
    });

    it("одно упоминание → не спам", () => {
      expect(detectSpam({ text: "спасибо @sofia за расклад", ...commenter })).toEqual({
        spam: false,
      });
    });
  });

  describe("растянутые повторы (repeat)", () => {
    it("длинная серия одного символа → спам", () => {
      expect(detectSpam({ text: "дааааа согласна", ...commenter })).toEqual({
        spam: true,
        reason: "repeat",
      });
    });

    it("много восклицательных подряд → спам", () => {
      expect(detectSpam({ text: "круто!!!!!", ...commenter })).toEqual({
        spam: true,
        reason: "repeat",
      });
    });

    it("обычное удвоение букв → не спам", () => {
      expect(detectSpam({ text: "класс, ванна кажется права", ...commenter })).toEqual({
        spam: false,
      });
    });
  });

  describe("стоп-слова (stopword)", () => {
    const stopWords = ["казино", "порча"];

    it("совпадение со стоп-словом → спам", () => {
      expect(
        detectSpam({ text: "лучшее казино для вас", stopWords, ...commenter }),
      ).toEqual({ spam: true, reason: "stopword" });
    });

    it("стоп-слово с растянутыми буквами (нормализация) → спам", () => {
      expect(
        detectSpam({ text: "казинооо ждёт", stopWords, ...commenter }),
      ).toEqual({ spam: true, reason: "stopword" });
    });

    it("текст без стоп-слов → не спам", () => {
      expect(
        detectSpam({ text: "какая красивая карта", stopWords, ...commenter }),
      ).toEqual({ spam: false });
    });

    it("пустой список стоп-слов → эвристика молчит", () => {
      expect(
        detectSpam({ text: "казино казино казино", stopWords: [], ...commenter }),
      ).toEqual({ spam: false });
    });
  });

  describe("чистый текст и привилегии", () => {
    it("нормальный коммент → не спам", () => {
      expect(
        detectSpam({ text: "спасибо большое, всё сбылось!", ...commenter }),
      ).toEqual({ spam: false });
    });

    it("привилегированный отправитель со спам-текстом → не спам", () => {
      expect(
        detectSpam({
          text: "https://casino.win @a @b @c",
          isPrivileged: true,
          stopWords: ["казино"],
        }),
      ).toEqual({ spam: false });
    });
  });
});

describe("токсичность (Шаг 11e)", () => {
  describe("buildToxicityPrompt", () => {
    it("включает нишу и название канала в system", () => {
      const { system } = buildToxicityPrompt(toxInput);
      expect(system).toContain("таро и эзотерика");
      expect(system).toContain("София Гадалка");
    });

    it("добавляет правило политики, когда оно задано", () => {
      const { system } = buildToxicityPrompt({
        ...toxInput,
        policy: "насмешки над картами",
      });
      expect(system).toContain("насмешки над картами");
    });

    it("не добавляет строку политики, когда она пустая", () => {
      const { system } = buildToxicityPrompt({ ...toxInput, policy: "  " });
      expect(system).not.toContain("Дополнительно для этого канала");
    });
  });

  describe("parseToxicityVerdict", () => {
    it("валидный JSON → вердикт", () => {
      expect(parseToxicityVerdict('{"toxic":true,"reason":"оскорбление"}')).toEqual({
        toxic: true,
        reason: "оскорбление",
      });
    });

    it("битый JSON → null", () => {
      expect(parseToxicityVerdict("не json")).toBeNull();
    });

    it("неполный JSON (нет поля) → null", () => {
      expect(parseToxicityVerdict('{"toxic":true}')).toBeNull();
    });
  });

  describe("shouldCheckToxicity (пред-фильтр)", () => {
    it("эмодзи/пунктуация → не проверяем", () => {
      expect(shouldCheckToxicity("❤️🔥")).toBe(false);
      expect(shouldCheckToxicity("!!!")).toBe(false);
    });

    it("нормальный текст и короткое оскорбление → проверяем", () => {
      expect(shouldCheckToxicity("какая красивая карта")).toBe(true);
      expect(shouldCheckToxicity("ты дура")).toBe(true);
    });
  });

  describe("classifyToxicity (сервис с фейк-клиентом)", () => {
    const deps = { logger: silentLogger, apiKey: "test-key" };

    it("токсичный вердикт от модели", async () => {
      const client = fakeClient('{"toxic":true,"reason":"нападки на автора"}');
      expect(await classifyToxicity(deps, toxInput, client)).toEqual({
        toxic: true,
        reason: "нападки на автора",
      });
    });

    it("не токсичный вердикт от модели", async () => {
      const client = fakeClient('{"toxic":false,"reason":""}');
      expect(await classifyToxicity(deps, toxInput, client)).toEqual({
        toxic: false,
        reason: "",
      });
    });

    it("нет ключа → null (фича молчит)", async () => {
      const client = fakeClient('{"toxic":true,"reason":"x"}');
      expect(
        await classifyToxicity({ logger: silentLogger, apiKey: undefined }, toxInput, client),
      ).toBeNull();
    });

    it("ошибка клиента → null (мягкая деградация)", async () => {
      const throwing: AiTextClient = {
        complete: () => Promise.reject(new Error("network")),
      };
      expect(await classifyToxicity(deps, toxInput, throwing)).toBeNull();
    });

    it("кривой ответ модели → null", async () => {
      const client = fakeClient("мусор не json");
      expect(await classifyToxicity(deps, toxInput, client)).toBeNull();
    });
  });
});
