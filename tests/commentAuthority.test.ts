import { describe, expect, it } from "vitest";
import { shouldHandleComment } from "../src/core/comments/commentAuthority";

const CLIENT = 555; // Telegram-id владельца бота клиента.
const OTHER = 777; // Telegram-id постороннего владельца.

describe("shouldHandleComment — общий бот", () => {
  it("бесхозный канал без бота клиента → отвечает", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: undefined,
        channelOwnerTelegramId: null,
        channelOwnerHasClientBot: false,
      }),
    ).toBe(true);
  });

  it("канал с владельцем, но без своего бота → отвечает (как раньше)", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: undefined,
        channelOwnerTelegramId: OTHER,
        channelOwnerHasClientBot: false,
      }),
    ).toBe(true);
  });

  it("у владельца канала поднят свой бот → молчит (иначе двойной ответ)", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: undefined,
        channelOwnerTelegramId: OTHER,
        channelOwnerHasClientBot: true,
      }),
    ).toBe(false);
  });
});

describe("shouldHandleComment — бот клиента", () => {
  it("обсуждение СВОЕГО канала → отвечает", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: CLIENT,
        channelOwnerTelegramId: CLIENT,
        channelOwnerHasClientBot: true,
      }),
    ).toBe(true);
  });

  it("обсуждение ЧУЖОГО канала → молчит", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: CLIENT,
        channelOwnerTelegramId: OTHER,
        channelOwnerHasClientBot: true,
      }),
    ).toBe(false);
  });

  it("фолбэк резолва на бесхозный канал (владелец null) → молчит, не утаскивает в чужую группу", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: CLIENT,
        channelOwnerTelegramId: null,
        channelOwnerHasClientBot: false,
      }),
    ).toBe(false);
  });

  it("свой канал, даже если реестр ещё не видит бота → отвечает (решает совпадение владельца)", () => {
    expect(
      shouldHandleComment({
        clientOwnerUserId: CLIENT,
        channelOwnerTelegramId: CLIENT,
        channelOwnerHasClientBot: false,
      }),
    ).toBe(true);
  });
});
