import { describe, expect, it } from "vitest";
import {
  BP_PREFIX,
  decodePostButton,
  encodeChoiceCb,
  encodePredictionCb,
} from "../src/core/buttons/callback";
import { buildPostKeyboard } from "../src/services/postButtons";
import type { Button, Choice } from "../src/core/content/postSchema";

const CHANNEL_ID = `c${"a".repeat(24)}`; // cuid ~25 символов

describe("post-button callback: encode/decode round-trip", () => {
  it("choice кодируется и декодируется", () => {
    const data = encodeChoiceCb(CHANNEL_ID, 2, 1);
    expect(data).toBe(`${BP_PREFIX}:ch:${CHANNEL_ID}:2:1`);
    expect(decodePostButton(data)).toEqual({
      kind: "choice",
      channelId: CHANNEL_ID,
      externalId: 2,
      idx: 1,
    });
  });

  it("prediction кодируется и декодируется", () => {
    const data = encodePredictionCb(CHANNEL_ID, "button_cards");
    expect(data).toBe(`${BP_PREFIX}:pr:${CHANNEL_ID}:button_cards`);
    expect(decodePostButton(data)).toEqual({
      kind: "prediction",
      channelId: CHANNEL_ID,
      btnType: "button_cards",
    });
  });

  it("чужой префикс / битые поля / мусор → null", () => {
    expect(decodePostButton("m:home")).toBeNull(); // префикс меню
    expect(decodePostButton("ap:pub:id")).toBeNull(); // префикс одобрения
    expect(decodePostButton("bp:ch:cid:2")).toBeNull(); // мало частей
    expect(decodePostButton("bp:ch:cid:x:1")).toBeNull(); // externalId не число
    expect(decodePostButton("bp:ch::2:1")).toBeNull(); // пустой channelId
    expect(decodePostButton("bp:pr:cid:")).toBeNull(); // пустой btnType
    expect(decodePostButton("bp:bogus:cid:1")).toBeNull(); // неизвестный вид
    expect(decodePostButton("")).toBeNull();
  });

  it("обе формы с cuid-channelId влезают в лимит 64 байта", () => {
    expect(Buffer.byteLength(encodeChoiceCb(CHANNEL_ID, 99, 9), "utf8")).toBeLessThanOrEqual(64);
    expect(
      Buffer.byteLength(encodePredictionCb(CHANNEL_ID, "button_money"), "utf8"),
    ).toBeLessThanOrEqual(64);
  });
});

describe("buildPostKeyboard", () => {
  const choices: Choice[] = [
    { label: "❤️ Он молчит", answer: "Молчание — не уход." },
    { label: "💔 Застой", answer: "Застой — не конец." },
  ];
  const button: Button = { type: "button_cards", label: "🔮 Карты отвечают" };

  it("button_choice → по строке-кнопке на вариант с верными callback'ами", () => {
    const kb = buildPostKeyboard({
      channelId: CHANNEL_ID,
      externalId: 2,
      interactiveType: "button_choice",
      choices,
      button: null,
    });
    expect(kb).toBeDefined();
    const rows = kb?.inline_keyboard ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]).toMatchObject({
      text: "❤️ Он молчит",
      callback_data: encodeChoiceCb(CHANNEL_ID, 2, 0),
    });
    expect(rows[1]?.[0]).toMatchObject({
      callback_data: encodeChoiceCb(CHANNEL_ID, 2, 1),
    });
  });

  it("button_prediction → одна кнопка с label и callback по типу", () => {
    const kb = buildPostKeyboard({
      channelId: CHANNEL_ID,
      externalId: 5,
      interactiveType: "button_prediction",
      choices: null,
      button,
    });
    const rows = kb?.inline_keyboard ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toMatchObject({
      text: "🔮 Карты отвечают",
      callback_data: encodePredictionCb(CHANNEL_ID, "button_cards"),
    });
  });

  it("keyword_trigger / vote_123 / пустые данные → без клавиатуры", () => {
    const base = { channelId: CHANNEL_ID, externalId: 1, choices: null, button: null };
    expect(
      buildPostKeyboard({ ...base, interactiveType: "keyword_trigger" }),
    ).toBeUndefined();
    expect(buildPostKeyboard({ ...base, interactiveType: "vote_123" })).toBeUndefined();
    // тип choice, но без вариантов / тип prediction, но без кнопки → тоже пусто
    expect(
      buildPostKeyboard({ ...base, interactiveType: "button_choice", choices: [] }),
    ).toBeUndefined();
    expect(
      buildPostKeyboard({ ...base, interactiveType: "button_prediction" }),
    ).toBeUndefined();
  });
});
