import { describe, expect, it } from "vitest";
import {
  buildQueueSummaryLine,
  summarisePendingQueue,
  type QueueItem,
} from "../src/core/approval/queueSummary";
import { cbByteLength, encodeCb } from "../src/core/menu/callbackData";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    externalId: 1,
    createdAt: new Date("2026-07-10T09:00:00Z"),
    ...over,
  };
}

describe("summarisePendingQueue", () => {
  it("пустая очередь → нули и oldest=null", () => {
    expect(summarisePendingQueue([])).toEqual({
      total: 0,
      fromPlan: 0,
      fromAi: 0,
      oldest: null,
    });
  });

  it("разделяет посты плана и AI по externalId", () => {
    const s = summarisePendingQueue([
      item({ externalId: 5 }),
      item({ externalId: null }),
      item({ externalId: null }),
      item({ externalId: 7 }),
    ]);
    expect(s.total).toBe(4);
    expect(s.fromPlan).toBe(2);
    expect(s.fromAi).toBe(2);
  });

  it("находит самый старый пост независимо от порядка входа", () => {
    const s = summarisePendingQueue([
      item({ createdAt: new Date("2026-07-12T09:00:00Z") }),
      item({ createdAt: new Date("2026-07-03T09:00:00Z") }),
      item({ createdAt: new Date("2026-07-08T09:00:00Z") }),
    ]);
    expect(s.oldest).toEqual(new Date("2026-07-03T09:00:00Z"));
  });
});

describe("buildQueueSummaryLine", () => {
  it("пустая очередь → понятная заглушка, без нулей", () => {
    const line = buildQueueSummaryLine(summarisePendingQueue([]), null);
    expect(line).toBe("Очередь пуста — все посты разобраны.");
  });

  it("13 постов: число, разбивка по источнику и возраст (исходная жалоба владельца)", () => {
    const items = [
      ...Array.from({ length: 9 }, () => item({ externalId: 1 })),
      ...Array.from({ length: 4 }, () => item({ externalId: null })),
    ];
    const line = buildQueueSummaryLine(summarisePendingQueue(items), "03.07");
    expect(line).toBe("13 постов ждут решения · 9 из плана, 4 от AI · самый старый от 03.07");
  });

  it("склоняет «пост» и «ждёт» для одного", () => {
    const line = buildQueueSummaryLine(summarisePendingQueue([item()]), "10.07");
    expect(line).toBe("1 пост ждёт решения · 1 из плана · самый старый от 10.07");
  });

  it("склоняет для 2–4", () => {
    const line = buildQueueSummaryLine(
      summarisePendingQueue([item(), item({ externalId: null })]),
      "10.07",
    );
    expect(line).toContain("2 поста ждут решения");
  });

  it("источник с нулём не показываем (только AI-посты)", () => {
    const line = buildQueueSummaryLine(
      summarisePendingQueue([item({ externalId: null }), item({ externalId: null })]),
      "10.07",
    );
    expect(line).toContain("2 от AI");
    expect(line).not.toContain("из плана");
  });

  it("без даты самого старого строка не разваливается", () => {
    const line = buildQueueSummaryLine(summarisePendingQueue([item()]), null);
    expect(line).toBe("1 пост ждёт решения · 1 из плана");
  });
});

describe("callback карточки поста очереди", () => {
  it("cuid влезает в лимит Telegram (64 байта)", () => {
    // Реальный cuid Prisma — 25 символов; берём с запасом.
    const data = encodeCb("api", "clz9x8y7w6v5u4t3s2r1q0p9o");
    expect(cbByteLength(data)).toBeLessThanOrEqual(64);
  });
});
