import type { Logger } from "pino";
import {
  buildReplyPrompt,
  parseReplyText,
  type ReplyPromptInput,
} from "../../core/ai/buildReplyPrompt.js";
import {
  createAnthropicClient,
  CLASSIFY_MODEL,
  type AiTextClient,
} from "./aiGenerationService.js";

/**
 * Сервис AI-ответа в комментах (Шаг 11c) — оркестрация: промпт → Claude (ДЕШЁВАЯ
 * модель Haiku) → короткий текст ответа. Сеть изолирована за `AiTextClient`, поэтому
 * `generateReply` тестируется с фейковым клиентом. Мягкая деградация как у
 * `generatePostDraft`: нет ключа / ошибка / пустой ответ → `null`, вызывающий не падает.
 */

export type { AiTextClient };

/** Максимум символов комментария, отправляемых в промпт (защита от «простыни»). */
const MAX_COMMENT_LENGTH = 500;

/** Зависимости: логгер + ключ (может отсутствовать) + опц. таймаут (Шаг 11b). */
export interface AiReplyDeps {
  logger: Logger;
  apiKey: string | undefined;
  timeoutMs?: number | undefined;
}

/** Обрезает длинный комментарий, чтобы не раздувать промпт/расход токенов. */
function clipComment(comment: string): string {
  const trimmed = comment.trim();
  return trimmed.length <= MAX_COMMENT_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_COMMENT_LENGTH);
}

/**
 * Генерирует короткий AI-ответ в тоне канала. Нет ключа → `null` (лог info), как
 * `generatePostDraft`. Ошибка сети/таймаут или пустой/слишком длинный ответ модели →
 * `null` (лог warn): бот просто промолчит, стадия комментов вернёт `"pass"`.
 *
 * ДЕШЁВАЯ модель (`CLASSIFY_MODEL`) и текстовый режим (`jsonSchema: null`) — политика
 * защиты API из `План.txt`: короткие ответы в комментах не жгут дорогую модель.
 * `client` инъектируется в тестах; в проде строится из ключа `createAnthropicClient`.
 */
export async function generateReply(
  deps: AiReplyDeps,
  input: ReplyPromptInput,
  client?: AiTextClient,
): Promise<string | null> {
  const { logger, apiKey } = deps;
  if (apiKey === undefined || apiKey === "") {
    logger.info("AI-ответ отключён: нет ANTHROPIC_API_KEY");
    return null;
  }
  const ai =
    client ??
    createAnthropicClient(apiKey, {
      model: CLASSIFY_MODEL,
      jsonSchema: null,
      timeoutMs: deps.timeoutMs,
    });
  const { system, user } = buildReplyPrompt({
    ...input,
    comment: clipComment(input.comment),
  });
  try {
    const text = await ai.complete(system, user);
    return parseReplyText(text);
  } catch (err) {
    logger.warn({ err }, "AI-ответ не удался — молчим (null)");
    return null;
  }
}
