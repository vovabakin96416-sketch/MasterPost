import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import {
  buildPostPrompt,
  type PostPromptInput,
} from "../../core/ai/buildPostPrompt.js";
import { parsePostDraftJson, type PostDraft } from "../../core/ai/postDraft.js";

/**
 * Сервис AI-генерации постов (Шаг 10) — оркестрация: промпт → Claude → черновик.
 *
 * Сеть изолирована за интерфейсом `AiTextClient`, поэтому `generatePostDraft`
 * тестируется с фейковым клиентом, без реальных вызовов API. Мягкая деградация как
 * у `genProvider`/Pexels: нет ключа или ошибка → `null`, вызывающий не падает.
 */

/** Модель генерации (самая сильная по умолчанию; правило claude-api). */
export const GENERATION_MODEL = "claude-opus-4-8";

/** Потолок ответа: один короткий пост укладывается с запасом. */
const MAX_TOKENS = 1024;

/**
 * JSON-схема черновика для Structured Outputs. БЕЗ min/maxLength — они не
 * поддерживаются structured outputs; длину/непустоту проверяет zod после разбора.
 */
const DRAFT_JSON_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  properties: {
    title: { type: "string" },
    text: { type: "string" },
    cta: { type: "string" },
    pexelsQuery: { type: "string" },
  },
  required: ["title", "text", "cta", "pexelsQuery"],
  additionalProperties: false,
};

/** Тонкий сетевой клиент генерации текста — за интерфейсом ради тестируемости. */
export interface AiTextClient {
  complete(system: string, user: string): Promise<string>;
}

/** Реальный клиент поверх @anthropic-ai/sdk (Structured Outputs → чистый JSON). */
export function createAnthropicClient(apiKey: string): AiTextClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete(system, user) {
      const message = await client.messages.create({
        model: GENERATION_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema: DRAFT_JSON_SCHEMA } },
      });
      // Structured Outputs отдаёт JSON текстовым блоком; собираем text-блоки.
      return message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
    },
  };
}

/** Зависимости генерации: логгер + ключ (может отсутствовать → мягкая деградация). */
export interface AiGenerationDeps {
  logger: Logger;
  apiKey: string | undefined;
}

/**
 * Генерирует AI-черновик поста по данным канала. Нет ключа → `null` (лог info),
 * как `genProvider` без ключа Pexels. Ошибка сети/парсинга → лог warn + `null`:
 * вызывающий (dev-скрипт в 10a, меню в 10b) не падает, а просто «не удалось».
 *
 * `client` инъектируется в тестах; в проде строится из ключа `createAnthropicClient`.
 */
export async function generatePostDraft(
  deps: AiGenerationDeps,
  input: PostPromptInput,
  client?: AiTextClient,
): Promise<PostDraft | null> {
  const { logger, apiKey } = deps;
  if (apiKey === undefined || apiKey === "") {
    logger.info("AI-генерация отключена: нет ANTHROPIC_API_KEY");
    return null;
  }
  const ai = client ?? createAnthropicClient(apiKey);
  const { system, user } = buildPostPrompt(input);
  try {
    const text = await ai.complete(system, user);
    return parsePostDraftJson(text);
  } catch (err) {
    logger.warn({ err }, "AI-генерация не удалась — откат (null)");
    return null;
  }
}
