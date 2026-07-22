import { describe, expect, it } from "vitest";
import {
  matchChannelBySenderChat,
  resolveCommentChannel,
  type RoutableChannel,
} from "../src/core/comments/routeChannel";

const taro: RoutableChannel = {
  id: "ch-taro",
  username: "@sofia_gada1ka",
  chatId: "@sofia_gada1ka",
  triggerWords: ["карта", "кофе"],
  ownerId: null,
  ownerTelegramUserId: null,
};
const news: RoutableChannel = {
  id: "ch-news",
  username: "@daily_news",
  chatId: "-1001234567890",
  triggerWords: ["погода"],
  ownerId: null,
  ownerTelegramUserId: null,
};
const channels: RoutableChannel[] = [taro, news];

describe("matchChannelBySenderChat", () => {
  it("матчит по username без ведущего @ (sender_chat отдаёт без @)", () => {
    expect(
      matchChannelBySenderChat({ id: -100, username: "sofia_gada1ka" }, channels),
    ).toBe(taro);
  });

  it("игнорирует регистр username", () => {
    expect(
      matchChannelBySenderChat({ id: -100, username: "Sofia_Gada1ka" }, channels),
    ).toBe(taro);
  });

  it("матчит по числовому id против числового chatId", () => {
    expect(
      matchChannelBySenderChat({ id: -1001234567890 }, channels),
    ).toBe(news);
  });

  it("нет совпадения → null", () => {
    expect(
      matchChannelBySenderChat({ id: -999, username: "other" }, channels),
    ).toBeNull();
  });

  it("отсутствие sender_chat → null", () => {
    expect(matchChannelBySenderChat(null, channels)).toBeNull();
    expect(matchChannelBySenderChat(undefined, channels)).toBeNull();
  });
});

describe("resolveCommentChannel", () => {
  it("приоритет у выученной связи", () => {
    // sender_chat указывает на taro, но выучен news → берём news.
    expect(resolveCommentChannel("ch-news", taro, channels)).toBe(news);
  });

  it("выученный id уже не в списке активных → игнорируем, идём дальше", () => {
    expect(resolveCommentChannel("ch-gone", news, channels)).toBe(news);
  });

  it("без выученного — фолбэк на совпадение по sender_chat", () => {
    expect(resolveCommentChannel(null, news, channels)).toBe(news);
  });

  it("без выученного и без sender_chat — первый канал списка", () => {
    expect(resolveCommentChannel(null, null, channels)).toBe(taro);
  });

  it("пустой список каналов → null", () => {
    expect(resolveCommentChannel(null, null, [])).toBeNull();
    expect(resolveCommentChannel("ch-taro", null, [])).toBeNull();
  });
});
