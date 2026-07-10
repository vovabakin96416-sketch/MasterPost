import { z } from "zod";

/**
 * Построитель промпта для AI-ответа в комментах (Шаг 11c). ЧИСТАЯ функция: по тону
 * канала (title/niche/toneOfVoice/language) и тексту комментария собирает
 * детерминированную пару system/user для Claude. Ни сети, ни SDK — покрыто тестами.
 *
 * Тематики в коде НЕТ: голос канала приходит данными (`Channel.niche/toneOfVoice/
 * language`), поэтому один код обслуживает таро-канал и любую другую нишу. В отличие
 * от `buildPostPrompt` (JSON-черновик поста), здесь ждём ОДИН короткий текст-ответ.
 */

/** Вход построителя промпта ответа. */
export interface ReplyPromptInput {
  channelTitle: string;
  niche: string;
  toneOfVoice: string | null;
  language: string;
  comment: string;
}

/** Готовая пара сообщений для `messages.create`. */
export interface ReplyPrompt {
  system: string;
  user: string;
}

/** Верхняя граница длины ответа модели (короткий коммент, с запасом под лимит TG). */
export const MAX_REPLY_LENGTH = 600;

/**
 * Схема ответа модели: непустой текст в пределах лимита. Пусто/пробелы или
 * превышение лимита → ошибка валидации (сервис трактует это как «нет ответа», null).
 */
export const replyTextSchema = z.string().trim().min(1).max(MAX_REPLY_LENGTH);

/**
 * Валидирует «сырой» текст ответа модели. Возвращает обрезанную строку или `null`
 * (мягкая деградация, как `parsePostDraftJson`, но без исключения — короткий ответ
 * не критичен, молчание допустимо).
 */
export function parseReplyText(raw: string): string | null {
  const result = replyTextSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Собирает пару system/user из тона канала и текста коммента (детерминированно). */
export function buildReplyPrompt(input: ReplyPromptInput): ReplyPrompt {
  const tone = input.toneOfVoice?.trim();
  const system = [
    `Ты ведёшь Telegram-канал «${input.channelTitle}» (ниша: ${input.niche}).`,
    "Тебе пишут комментарий под постом. Ответь ОДНИМ коротким сообщением —",
    "тепло и по делу, в тоне канала, как будто отвечает автор канала.",
    "",
    "Требования:",
    `- Пиши на языке канала (код языка: ${input.language}).`,
    tone !== undefined && tone !== ""
      ? `- Держи tone of voice канала: ${tone}.`
      : "- Держи дружелюбный, живой тон канала.",
    "- Коротко: 1–2 предложения, без markdown и без списков.",
    "- Не давай медицинских, юридических и финансовых гарантий; без обещаний точных предсказаний.",
    "- Верни ТОЛЬКО текст ответа — без кавычек и пояснений.",
  ].join("\n");

  const user = [
    "Комментарий читателя:",
    input.comment,
    "",
    "Напиши ответ.",
  ].join("\n");

  return { system, user };
}
