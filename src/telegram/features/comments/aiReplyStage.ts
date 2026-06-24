import type { CommentStage } from "./types.js";

/**
 * Стадия AI-ответа в тоне канала — ЗАГЛУШКА (точка расширения, Шаг 11).
 *
 * Сработает, когда триггер не совпал: здесь будущий вызов Claude сгенерирует
 * ответ в tone of voice канала. Сейчас всегда `"pass"` (бот молчит) — реальный
 * вызов подключим позже, не трогая остальной конвейер. Стоит ПОСЛЕДНЕЙ.
 */
export function createAiReplyStage(): CommentStage {
  return {
    name: "ai-reply",
    handle(): Promise<"pass"> {
      return Promise.resolve("pass");
    },
  };
}
