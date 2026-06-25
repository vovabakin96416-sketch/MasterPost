import type { MediaProvider } from "./provider.js";

/**
 * Платный провайдер фото — AI-генерация (Шаг 6a, ЗАГЛУШКА).
 *
 * Архитектура двух версий заложена сейчас, реальный движок генерации подключаем
 * на Шаге 10 (нужен внешний image-API + бюджет; у Anthropic генерации картинок нет).
 * Пока `fetch` возвращает `null` → `mediaService` откатывается на сток (Pexels),
 * чтобы платный канал не остался без картинки до Шага 10.
 */
export const genProvider: MediaProvider = {
  name: "generation",

  async fetch(query, { logger }) {
    logger.info(
      { query },
      "AI-генерация фото будет подключена на Шаге 10 — откат на сток (Pexels)",
    );
    return null;
  },
};
