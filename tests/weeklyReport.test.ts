import { describe, expect, it } from "vitest";
import {
  buildWeeklyReport,
  messageToMetric,
  summariseWeekly,
  type PostMetricInput,
  type RawMessageLike,
} from "../src/core/analytics/weeklyReport";

const TZ = "Europe/Moscow";

function metric(over: Partial<PostMetricInput> = {}): PostMetricInput {
  return {
    messageId: 1,
    views: 100,
    reactions: 5,
    replies: 2,
    preview: "Текст поста",
    postedAt: new Date("2026-06-22T07:00:00Z"), // 10:00 МСК
    ...over,
  };
}

describe("summariseWeekly", () => {
  it("пустой список → нули и best=null", () => {
    const s = summariseWeekly([]);
    expect(s).toEqual({
      count: 0,
      totalViews: 0,
      avgViews: 0,
      totalReactions: 0,
      best: null,
    });
  });

  it("суммы, среднее (floor) и лучший пост по просмотрам", () => {
    const s = summariseWeekly([
      metric({ messageId: 1, views: 100, reactions: 3 }),
      metric({ messageId: 2, views: 250, reactions: 7 }),
      metric({ messageId: 3, views: 9, reactions: 1 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.totalViews).toBe(359);
    expect(s.avgViews).toBe(119); // floor(359/3)
    expect(s.totalReactions).toBe(11);
    expect(s.best?.messageId).toBe(2);
  });

  it("при равных просмотрах лучший — первый встреченный", () => {
    const s = summariseWeekly([
      metric({ messageId: 1, views: 50 }),
      metric({ messageId: 2, views: 50 }),
    ]);
    expect(s.best?.messageId).toBe(1);
  });
});

describe("buildWeeklyReport", () => {
  it("пустой список → понятная заглушка", () => {
    const text = buildWeeklyReport([], TZ);
    expect(text).toContain("Аналитика за прошлую неделю");
    expect(text).toContain("Постов за последние 7 дней не найдено");
  });

  it("один пост: дата в поясе канала, метрики, итоги и лучший", () => {
    const text = buildWeeklyReport(
      [
        metric({
          views: 120,
          reactions: 4,
          replies: 3,
          preview: "Карта дня",
          postedAt: new Date("2026-06-22T07:00:00Z"),
        }),
      ],
      TZ,
    );
    expect(text).toContain("📅 22.06 10:00"); // 07:00 UTC → 10:00 МСК
    expect(text).toContain("👁 120 · ❤️ 4 · 💬 3");
    expect(text).toContain("Карта дня");
    expect(text).toContain("Постов: 1");
    expect(text).toContain("Просмотров: 120 (среднее: 120)");
    expect(text).toContain("🏆 *Лучший пост:*");
    expect(text).toContain("👁 120 просмотров");
  });

  it("чистит превью от переносов и звёздочек (не ломает Markdown)", () => {
    const text = buildWeeklyReport(
      [metric({ preview: "Строка*1\nСтрока 2" })],
      TZ,
    );
    expect(text).not.toContain("*1");
    expect(text).toContain("Строка1 Строка 2");
  });

  it("сортирует посты хронологически независимо от входного порядка", () => {
    const text = buildWeeklyReport(
      [
        metric({
          messageId: 2,
          preview: "Поздний",
          postedAt: new Date("2026-06-24T07:00:00Z"),
        }),
        metric({
          messageId: 1,
          preview: "Ранний",
          postedAt: new Date("2026-06-22T07:00:00Z"),
        }),
      ],
      TZ,
    );
    expect(text.indexOf("Ранний")).toBeLessThan(text.indexOf("Поздний"));
  });
});

function raw(over: Partial<RawMessageLike> = {}): RawMessageLike {
  return {
    id: 10,
    date: 1_700_000_000, // unix-секунды
    message: "Подпись",
    media: undefined,
    views: 100,
    reactions: undefined,
    replies: undefined,
    ...over,
  };
}

describe("messageToMetric", () => {
  it("фото без подписи (message=undefined) → не падает, превью пустое", () => {
    // Регрессия: раньше undefined.slice → «Cannot read properties of undefined».
    const m = messageToMetric(raw({ message: undefined, media: { photo: true } }));
    expect(m).not.toBeNull();
    expect(m?.preview).toBe("");
    expect(m?.views).toBe(100);
  });

  it("служебное сообщение (без текста и медиа) → null", () => {
    expect(messageToMetric(raw({ message: undefined, media: undefined }))).toBeNull();
    expect(messageToMetric(raw({ message: "", media: undefined }))).toBeNull();
  });

  it("текстовый пост → метрики и дата из unix-секунд", () => {
    const m = messageToMetric(
      raw({
        id: 42,
        date: 1_700_000_000,
        message: "Карта дня",
        views: 250,
        replies: { replies: 7 },
      }),
    );
    expect(m).toEqual({
      messageId: 42,
      views: 250,
      reactions: 0,
      replies: 7,
      preview: "Карта дня",
      postedAt: new Date(1_700_000_000 * 1000),
    });
  });

  it("суммирует количество по всем реакциям", () => {
    const m = messageToMetric(
      raw({ reactions: { results: [{ count: 3 }, { count: 4 }] } }),
    );
    expect(m?.reactions).toBe(7);
  });

  it("длинное превью режется до 80 символов", () => {
    const m = messageToMetric(raw({ message: "я".repeat(200) }));
    expect(m?.preview.length).toBe(80);
  });
});
