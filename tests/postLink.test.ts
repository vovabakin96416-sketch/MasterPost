import { describe, expect, it } from "vitest";
import { buildPostLink } from "../src/core/analytics/postLink";

describe("buildPostLink", () => {
  it("публичный канал → t.me/<username>/<id>", () => {
    expect(buildPostLink({ username: "sofia_gada1ka", chatId: null }, 42)).toBe(
      "https://t.me/sofia_gada1ka/42",
    );
  });

  it("срезает ведущую @ у username", () => {
    expect(buildPostLink({ username: "@sofia_gada1ka", chatId: null }, 7)).toBe(
      "https://t.me/sofia_gada1ka/7",
    );
  });

  it("username важнее числового chatId", () => {
    expect(
      buildPostLink({ username: "sofia_gada1ka", chatId: "-1001234567890" }, 5),
    ).toBe("https://t.me/sofia_gada1ka/5");
  });

  it("без username, числовой -100… → приватная t.me/c/<id>/<msg>", () => {
    expect(buildPostLink({ username: null, chatId: "-1001234567890" }, 12)).toBe(
      "https://t.me/c/1234567890/12",
    );
  });

  it("chatId задан как @username (см. схему Channel.chatId) → публичная ссылка", () => {
    expect(buildPostLink({ username: null, chatId: "@sofia_gada1ka" }, 3)).toBe(
      "https://t.me/sofia_gada1ka/3",
    );
  });

  it("нет ни username, ни chatId → null (ссылку не построить)", () => {
    expect(buildPostLink({ username: null, chatId: null }, 1)).toBeNull();
  });

  it("пустые строки и пробелы считаются отсутствием данных", () => {
    expect(buildPostLink({ username: "", chatId: "  " }, 1)).toBeNull();
  });

  it("старый числовой id без -100 → null, а не битая ссылка", () => {
    expect(buildPostLink({ username: null, chatId: "-987654321" }, 1)).toBeNull();
  });
});
