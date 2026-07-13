import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  buildAdvisorPrompt,
  parseAdvisorVerdict,
  ADVISOR_JSON_SCHEMA,
  type AdvisorPromptInput,
  type AdvisorVerdict,
} from "../../core/experiments/buildAdvisorPrompt.js";
import { getDimensionSpec } from "../../core/experiments/experiment.js";
import { isStrategyExpired } from "../../core/experiments/learnedStrategy.js";
import { getReplyChannelById } from "../../db/repositories/channelRepository.js";
import { localDateParts } from "../../core/schedule/localDate.js";
import { tryConsumeDailyBudget } from "../ai/aiBudget.js";
import {
  createAnthropicClient,
  CLASSIFY_MODEL,
  type AiTextClient,
} from "../ai/aiGenerationService.js";
import { getExperimentAdvisorEnabled } from "./experimentAdvisorSettings.js";
import { getLearnedStrategy } from "./optimizationService.js";

/**
 * Сервис AI-советника экспериментов (Шаг 13f) — оркестрация: инсайты 12c → Claude
 * (ДЕШЁВАЯ модель Haiku, Structured Outputs) → вердикт «какое измерение тестировать
 * следующим» + обоснование. Сеть изолирована за `AiTextClient` — `generateAdvice`
 * тестируется с фейковым клиентом.
 *
 * Мягкая деградация как у `generateGrowthNarrative`: нет ключа / выключен тумблер /
 * исчерпан бюджет / ошибка / кривой ответ → `null` (расход 0, вызывающий покажет
 * понятную заглушку). Подтверждение совета запускает эксперимент существующим путём
 * `startExperiment` (13d) — тут только предложение.
 */

export type { AiTextClient };

/** Максимум символов текста фактов, отправляемых в промпт (защита от «простыни»). */
const MAX_FACTS_LENGTH = 3000;

/** Совет владельцу: какое измерение тестировать + подпись каталога + обоснование. */
export interface ExperimentAdvice {
  dimension: AdvisorVerdict["dimension"];
  label: string;
  rationale: string;
}

/** Зависимости AI-вызова: логгер + ключ (может отсутствовать) + опц. таймаут (11b). */
export interface AdvisorDeps {
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
 * Спрашивает у модели, какое измерение тестировать следующим. Нет ключа → `null`
 * (лог info), как `generateGrowthNarrative`. Ошибка сети/таймаут или неразобранный
 * ответ → `null` (лог warn). ДЕШЁВАЯ модель + JSON-схема каталога (`ADVISOR_JSON_SCHEMA`).
 * `client` инъектируется в тестах; в проде строится из ключа.
 */
export async function generateAdvice(
  deps: AdvisorDeps,
  input: AdvisorPromptInput,
  client?: AiTextClient,
): Promise<AdvisorVerdict | null> {
  const { logger, apiKey } = deps;
  if (apiKey === undefined || apiKey === "") {
    logger.info("AI-советник экспериментов отключён: нет ANTHROPIC_API_KEY");
    return null;
  }
  const ai =
    client ??
    createAnthropicClient(apiKey, {
      model: CLASSIFY_MODEL,
      jsonSchema: ADVISOR_JSON_SCHEMA,
      timeoutMs: deps.timeoutMs,
    });
  const { system, user } = buildAdvisorPrompt({
    ...input,
    factsReport: clipFacts(input.factsReport),
  });
  try {
    const text = await ai.complete(system, user);
    return parseAdvisorVerdict(text);
  } catch (err) {
    logger.warn({ err }, "AI-советник экспериментов не удался — молчим (null)");
    return null;
  }
}

/** Зависимости оркестратора: БД (тумблер/бюджет/тон/стратегия) + AI-вызов. */
export interface AdviseNextDeps extends AdvisorDeps {
  prisma: PrismaClient;
}

/**
 * Предлагает следующий эксперимент по инсайтам 12c, если владелец включил тумблер
 * «🔮 AI-советник». Ворота от дешёвых к дорогим (как 11c/11e/12d): тумблер → ключ →
 * тон канала → дневной бюджет (ОБЩИЙ `ai_daily_cap`, списываем ДО вызова) → Haiku.
 * Любой отказ → `null` (расход 0). Уже решённые измерения (непросроченная стратегия
 * 13e) передаются модели как «предпочти другое» — против схлопывания.
 */
export async function adviseNextExperiment(
  deps: AdviseNextDeps,
  channelId: string,
  factsReport: string,
  now: Date = new Date(),
  client?: AiTextClient,
): Promise<ExperimentAdvice | null> {
  const enabled = await getExperimentAdvisorEnabled(deps.prisma, channelId);
  if (!enabled) {
    return null;
  }
  if (deps.apiKey === undefined || deps.apiKey === "") {
    deps.logger.info("AI-советник включён, но нет ANTHROPIC_API_KEY");
    return null;
  }
  const channel = await getReplyChannelById(deps.prisma, channelId);
  if (channel === null) {
    return null;
  }
  const today = localDateParts(now, channel.timezone).isoDate;
  const withinBudget = await tryConsumeDailyBudget(deps.prisma, channelId, today);
  if (!withinBudget) {
    deps.logger.info({ channelId }, "AI-советник: дневной бюджет исчерпан");
    return null;
  }
  const strategy = await getLearnedStrategy(deps.prisma, channelId);
  const settledLabels = strategy
    .filter((e) => !isStrategyExpired(e, now))
    .map((e) => getDimensionSpec(e.dimension)?.label)
    .filter((label): label is string => label !== undefined && label !== null);

  const verdict = await generateAdvice(
    deps,
    {
      channelTitle: channel.title,
      niche: channel.niche,
      toneOfVoice: channel.toneOfVoice,
      language: channel.language,
      factsReport,
      settledLabels,
    },
    client,
  );
  if (verdict === null) {
    return null;
  }
  const spec = getDimensionSpec(verdict.dimension);
  if (spec === null) {
    return null;
  }
  return { dimension: verdict.dimension, label: spec.label, rationale: verdict.rationale };
}
