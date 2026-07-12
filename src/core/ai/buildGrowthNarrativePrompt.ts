import { z } from "zod";

/**
 * Построитель промпта AI-пересказа отчёта «Рост» (Шаг 12d). ЧИСТАЯ функция: по тону
 * канала (title/niche/toneOfVoice/language) и ГОТОВОМУ тексту фактов 12c собирает
 * детерминированную пару system/user для Claude. Ни сети, ни SDK — покрыто тестами.
 *
 * Ключевой принцип (как 11c/11e): факты уже посчитаны эвристиками 12a–12c — модель
 * их ТОЛЬКО переформулирует голосом канала, ничего не выдумывая. Тематики в коде
 * нет: голос приходит данными (`Channel.niche/toneOfVoice/language`).
 */

/** Вход построителя промпта пересказа: тон канала + готовый текст фактов 12c. */
export interface GrowthNarrativePromptInput {
  channelTitle: string;
  niche: string;
  toneOfVoice: string | null;
  language: string;
  /** Готовый эвристический отчёт `buildInsightsReport` (12c) — источник фактов. */
  factsReport: string;
}

/** Готовая пара сообщений для `messages.create`. */
export interface GrowthNarrativePrompt {
  system: string;
  user: string;
}

/** Верхняя граница длины пересказа (короче лимита сообщения TG, с запасом на отчёт 7c). */
export const MAX_NARRATIVE_LENGTH = 1500;

/**
 * Схема пересказа: непустой текст в пределах лимита. Пусто/пробелы или превышение
 * лимита → ошибка валидации (сервис трактует как «нет пересказа» → фолбэк на 12c).
 */
export const narrativeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NARRATIVE_LENGTH);

/**
 * Валидирует «сырой» текст пересказа модели. Возвращает обрезанную строку или `null`
 * (мягкая деградация — вызывающий покажет эвристический текст 12c). Markdown-эмфаза
 * (`*`/`_`) вычищается: текст идёт и в Markdown-отчёт (сломал бы parse_mode), и на
 * плейн-экран «📈 Рост» (звёздочки торчали бы как мусор) — то же правило, что в 12c.
 */
export function parseNarrative(raw: string): string | null {
  const cleaned = raw.replace(/[*_]/g, "");
  const result = narrativeTextSchema.safeParse(cleaned);
  return result.success ? result.data : null;
}

/** Собирает пару system/user из тона канала и текста фактов (детерминированно). */
export function buildGrowthNarrativePrompt(
  input: GrowthNarrativePromptInput,
): GrowthNarrativePrompt {
  const tone = input.toneOfVoice?.trim();
  const system = [
    `Ты — AI-директор Telegram-канала «${input.channelTitle}» (ниша: ${input.niche}).`,
    "Владельцу канала нужен пересказ готового аналитического отчёта — живым",
    "человеческим языком, как будто говорит вовлечённый директор канала.",
    "",
    "Требования:",
    `- Пиши на языке канала (код языка: ${input.language}).`,
    tone !== undefined && tone !== ""
      ? `- Держи tone of voice канала: ${tone}.`
      : "- Держи дружелюбный, живой тон канала.",
    "- Используй ТОЛЬКО факты и числа из отчёта — ничего не выдумывай и не добавляй.",
    "- Сохрани конкретику: дни, часы, проценты, рекомендации.",
    "- Коротко: 6–10 строк. Без Markdown-эмфазы (символов * и _), эмодзи можно.",
    "- Верни ТОЛЬКО текст пересказа — без кавычек и пояснений.",
  ].join("\n");

  const user = [
    "Отчёт с фактами:",
    input.factsReport,
    "",
    "Перескажи его владельцу канала.",
  ].join("\n");

  return { system, user };
}
