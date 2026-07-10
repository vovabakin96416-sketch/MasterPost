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

/**
 * Роутинг моделей (дёшево / дорого) — политика из `План.txt`, «Защита API».
 * ДОРОГАЯ модель — только для генерации постов и сложной аналитики. ВСЁ остальное
 * (ответы в комментах, модерация/классификация, оценка тем) — ДЕШЁВАЯ модель, чтобы
 * клиенты не «сожгли» токены. `CLASSIFY_MODEL` используется в Шагах 11c/11e.
 */
export const GENERATION_MODEL = "claude-opus-4-8";
export const CLASSIFY_MODEL = "claude-haiku-4-5";

/** Потолок ответа по умолчанию: один короткий пост укладывается с запасом. */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Таймаут вызова Claude по умолчанию (мс). Аналог `TIMEOUT_MS` у Pexels: без него
 * зависший запрос мог бы блокировать хендлер/тик надолго. Переопределяется env
 * `AI_TIMEOUT_MS` через `AiGenerationDeps.timeoutMs`.
 */
export const DEFAULT_AI_TIMEOUT_MS = 15_000;

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

/**
 * Опции клиента Claude. Дефолты = текущее поведение генерации постов (Opus, JSON-схема
 * черновика), поэтому `generatePostDraft` не меняется. Для коротких ответов/классификации
 * (11c/11e) можно передать `model: CLASSIFY_MODEL` и `jsonSchema: null` (чистый текст).
 */
export interface AnthropicClientOptions {
  model?: string | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
  /** JSON-схема Structured Outputs; `null` → обычный текстовый ответ (без output_config). */
  jsonSchema?: { [key: string]: unknown } | null | undefined;
}

/** Реальный клиент поверх @anthropic-ai/sdk (Structured Outputs → чистый JSON). */
export function createAnthropicClient(
  apiKey: string,
  options: AnthropicClientOptions = {},
): AiTextClient {
  const client = new Anthropic({ apiKey });
  const model = options.model ?? GENERATION_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const jsonSchema =
    options.jsonSchema === undefined ? DRAFT_JSON_SCHEMA : options.jsonSchema;
  return {
    async complete(system, user) {
      const message = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
          // output_config только когда нужен JSON; для текстовых ответов его нет.
          ...(jsonSchema !== null
            ? { output_config: { format: { type: "json_schema", schema: jsonSchema } } }
            : {}),
        },
        // Явный таймаут (мс) — Anthropic SDK принимает per-request options вторым аргументом.
        { timeout: timeoutMs },
      );
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
  /** Таймаут вызова Claude (мс). Нет значения → `DEFAULT_AI_TIMEOUT_MS`. */
  timeoutMs?: number | undefined;
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
  const ai = client ?? createAnthropicClient(apiKey, { timeoutMs: deps.timeoutMs });
  const { system, user } = buildPostPrompt(input);
  try {
    const text = await ai.complete(system, user);
    return parsePostDraftJson(text);
  } catch (err) {
    logger.warn({ err }, "AI-генерация не удалась — откат (null)");
    return null;
  }
}
