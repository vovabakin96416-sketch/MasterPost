import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  buildGrowthNarrativePrompt,
  parseNarrative,
  type GrowthNarrativePromptInput,
} from "../../core/ai/buildGrowthNarrativePrompt.js";
import { getReplyChannelById } from "../../db/repositories/channelRepository.js";
import { localDateParts } from "../../core/schedule/localDate.js";
import { getGrowthNarrativeEnabled } from "./growthNarrativeSettings.js";
import { tryConsumeDailyBudget } from "./aiBudget.js";
import {
  createAnthropicClient,
  CLASSIFY_MODEL,
  type AiTextClient,
} from "./aiGenerationService.js";

/**
 * Сервис AI-пересказа отчёта «Рост» (Шаг 12d) — оркестрация: готовый текст фактов 12c →
 * Claude (ДЕШЁВАЯ модель Haiku) → пересказ голосом канала. Сеть изолирована за
 * `AiTextClient`, поэтому `generateGrowthNarrative` тестируется с фейковым клиентом.
 *
 * Мягкая деградация как у `generateReply`: нет ключа / выключен тумблер / исчерпан
 * бюджет / ошибка / кривой ответ → показываем эвристический текст 12c (расход 0,
 * вызывающий не падает и не замечает разницы в типе результата).
 */

export type { AiTextClient };

/** Максимум символов текста фактов, отправляемых в промпт (защита от «простыни»). */
const MAX_FACTS_LENGTH = 3000;

/** Зависимости AI-вызова: логгер + ключ (может отсутствовать) + опц. таймаут (11b). */
export interface GrowthNarrativeDeps {
  logger: Logger;
  apiKey: string | undefined;
  timeoutMs?: number | undefined;
}

/** Обрезает длинный текст фактов, чтобы не раздувать промпт/расход токенов. */
function clipFacts(facts: string): string {
  const trimmed = facts.trim();
  return trimmed.length <= MAX_FACTS_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_FACTS_LENGTH);
}

/**
 * Генерирует пересказ фактов голосом канала. Нет ключа → `null` (лог info), как
 * `generateReply`. Ошибка сети/таймаут или пустой/слишком длинный ответ модели →
 * `null` (лог warn): вызывающий покажет эвристический текст 12c.
 *
 * ДЕШЁВАЯ модель (`CLASSIFY_MODEL`) и текстовый режим (`jsonSchema: null`) — политика
 * защиты API из `План.txt`. `client` инъектируется в тестах; в проде строится из ключа.
 */
export async function generateGrowthNarrative(
  deps: GrowthNarrativeDeps,
  input: GrowthNarrativePromptInput,
  client?: AiTextClient,
): Promise<string | null> {
  const { logger, apiKey } = deps;
  if (apiKey === undefined || apiKey === "") {
    logger.info("AI-пересказ роста отключён: нет ANTHROPIC_API_KEY");
    return null;
  }
  const ai =
    client ??
    createAnthropicClient(apiKey, {
      model: CLASSIFY_MODEL,
      jsonSchema: null,
      timeoutMs: deps.timeoutMs,
    });
  const { system, user } = buildGrowthNarrativePrompt({
    ...input,
    factsReport: clipFacts(input.factsReport),
  });
  try {
    const text = await ai.complete(system, user);
    return parseNarrative(text);
  } catch (err) {
    logger.warn({ err }, "AI-пересказ роста не удался — фолбэк на эвристический текст");
    return null;
  }
}

/** Зависимости оркестратора: БД (тумблер/бюджет/тон канала) + AI-вызов. */
export interface NarrateGrowthDeps extends GrowthNarrativeDeps {
  prisma: PrismaClient;
}

/**
 * Оборачивает готовый текст фактов 12c в AI-пересказ, если владелец включил тумблер
 * «🧠 AI-пересказ роста». Ворота от дешёвых к дорогим (как стадии 11c/11e): тумблер →
 * ключ → тон канала → дневной бюджет (ОБЩИЙ `ai_daily_cap`, списываем ДО вызова) →
 * Haiku. Любой отказ по пути → исходный `factsReport` без изменений (расход 0).
 */
export async function narrateGrowthReport(
  deps: NarrateGrowthDeps,
  channelId: string,
  factsReport: string,
  now: Date = new Date(),
  client?: AiTextClient,
): Promise<string> {
  const enabled = await getGrowthNarrativeEnabled(deps.prisma, channelId);
  if (!enabled) {
    return factsReport;
  }
  if (deps.apiKey === undefined || deps.apiKey === "") {
    deps.logger.info("AI-пересказ роста включён, но нет ANTHROPIC_API_KEY — эвристика");
    return factsReport;
  }
  const channel = await getReplyChannelById(deps.prisma, channelId);
  if (channel === null) {
    return factsReport;
  }
  const today = localDateParts(now, channel.timezone).isoDate;
  const withinBudget = await tryConsumeDailyBudget(deps.prisma, channelId, today);
  if (!withinBudget) {
    deps.logger.info({ channelId }, "AI-пересказ роста: дневной бюджет исчерпан");
    return factsReport;
  }
  const narrative = await generateGrowthNarrative(
    deps,
    {
      channelTitle: channel.title,
      niche: channel.niche,
      toneOfVoice: channel.toneOfVoice,
      language: channel.language,
      factsReport,
    },
    client,
  );
  return narrative ?? factsReport;
}
