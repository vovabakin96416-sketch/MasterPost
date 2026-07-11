import { describe, expect, it } from "vitest";
import { detectSpam } from "../src/core/moderation/detectSpam";

// Контекст обычного (не привилегированного) отправителя.
const commenter = { isPrivileged: false } as const;

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
