import type { Logger } from "pino";
import {
  buildToxicityPrompt,
  parseToxicityVerdict,
  MAX_COMMENT_LENGTH,
  TOXICITY_JSON_SCHEMA,
  type ToxicityPromptInput,
  type ToxicityVerdict,
} from "../../core/moderation/buildToxicityPrompt.js";
import {
  createAnthropicClient,
  CLASSIFY_MODEL,
  type AiTextClient,
} from "../ai/aiGenerationService.js";

/**
 * Сервис классификации токсичности комментов (Шаг 11e) — оркестрация: промпт → Claude
 * (ДЕШЁВАЯ модель Haiku, Structured Outputs) → вердикт `{ toxic, reason }`. Сеть изолирована
 * за `AiTextClient`, поэтому `classifyToxicity` тестируется с фейковым клиентом.
 *
 * Мягкая деградация как у `generateReply`: нет ключа / ошибка / кривой JSON → `null`,
 * вызывающий (стадия модерации) трактует это как «не токсично» и молчит.
 */

export type { AiTextClient };

/** Зависимости: логгер + ключ (может отсутствовать) + опц. таймаут (Шаг 11b). */
export interface ToxicityDeps {
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
 * Классифицирует токсичность коммента в контексте ниши канала. Нет ключа → `null`
 * (лог info), как `generateReply`. Ошибка сети/таймаут или неразобранный ответ →
 * `null` (лог warn): стадия трактует как «не токсично» и пропускает коммент дальше.
 *
 * ДЕШЁВАЯ модель (`CLASSIFY_MODEL`) + JSON-схема (`TOXICITY_JSON_SCHEMA`). `client`
 * инъектируется в тестах; в проде строится из ключа `createAnthropicClient`.
 */
export async function classifyToxicity(
  deps: ToxicityDeps,
  input: ToxicityPromptInput,
  client?: AiTextClient,
): Promise<ToxicityVerdict | null> {
  const { logger, apiKey } = deps;
  if (apiKey === undefined || apiKey === "") {
    logger.info("Модерация токсичности отключена: нет ANTHROPIC_API_KEY");
    return null;
  }
  const ai =
    client ??
    createAnthropicClient(apiKey, {
      model: CLASSIFY_MODEL,
      jsonSchema: TOXICITY_JSON_SCHEMA,
      timeoutMs: deps.timeoutMs,
    });
  const { system, user } = buildToxicityPrompt({
    ...input,
    comment: clipComment(input.comment),
  });
  try {
    const text = await ai.complete(system, user);
    return parseToxicityVerdict(text);
  } catch (err) {
    logger.warn({ err }, "классификация токсичности не удалась — молчим (null)");
    return null;
  }
}
