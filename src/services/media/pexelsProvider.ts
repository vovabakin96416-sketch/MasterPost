import type { MediaProvider } from "./provider.js";

/**
 * Бесплатный провайдер фото — Pexels (Шаг 6a). Порт `fetch_pexels_photo`:
 * ищет по запросу, берёт случайное из выдачи (портретная ориентация) → URL `large`.
 *
 * Нет ключа / ошибка / пустая выдача → `null` (бот публикует без фото). Никаких
 * исключений наружу: подбор фото не должен срывать публикацию.
 */

const ENDPOINT = "https://api.pexels.com/v1/search";
const PER_PAGE = 15;
const TIMEOUT_MS = 8000;

/** Минимально нужная форма ответа Pexels (берём только `src.large`). */
interface PexelsResponse {
  readonly photos?: ReadonlyArray<{ readonly src?: { readonly large?: string } }>;
}

export const pexelsProvider: MediaProvider = {
  name: "pexels",

  async fetch(query, { logger, apiKey }) {
    if (apiKey === undefined || apiKey === "") {
      return null;
    }
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("query", query);
      url.searchParams.set("per_page", String(PER_PAGE));
      url.searchParams.set("orientation", "portrait");

      const resp = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        logger.warn({ status: resp.status }, "Pexels: ответ не 2xx");
        return null;
      }
      const data = (await resp.json()) as PexelsResponse;
      const photos = data.photos ?? [];
      if (photos.length === 0) {
        return null;
      }
      const pick = photos[Math.floor(Math.random() * photos.length)];
      return pick?.src?.large ?? null;
    } catch (err) {
      logger.warn({ err }, "Pexels: ошибка запроса");
      return null;
    }
  },
};
