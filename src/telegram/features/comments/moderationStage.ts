import type { CommentStage } from "./types.js";

/**
 * Стадия модерации/антиспама — ЗАГЛУШКА (точка расширения, Шаг 9).
 *
 * Сейчас всегда `"pass"`: поведение бота не меняется. Здесь появятся фильтр
 * спама/ссылок, детект токсичности, авто-чистка, рейт-лимит на пользователя.
 * Стоит ПЕРВОЙ в конвейере, чтобы отсекать мусор до триггеров и AI.
 */
export function createModerationStage(): CommentStage {
  return {
    name: "moderation",
    handle(): Promise<"pass"> {
      return Promise.resolve("pass");
    },
  };
}
