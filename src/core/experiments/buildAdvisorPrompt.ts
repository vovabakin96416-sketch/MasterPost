import { z } from "zod";
import {
  EXPERIMENT_DIMENSIONS,
  EXPERIMENT_DIMENSION_KEYS,
  type ExperimentDimension,
} from "./experiment.js";

/**
 * Построитель промпта AI-советника экспериментов (Шаг 13f). ЧИСТАЯ функция: по тону
 * канала и ГОТОВОМУ тексту инсайтов 12c собирает детерминированную пару system/user
 * для дешёвой модели (Haiku). Ни сети, ни SDK — покрыто тестами.
 *
 * Задача модели — выбрать ОДНО измерение из фиксированного каталога 13a
 * (`EXPERIMENT_DIMENSIONS`), которое стоит проверить следующим, и коротко обосновать
 * фактами. Свободных тем нет: эксперимент умеет запускаться только по этим измерениям,
 * поэтому ответ ограничен их ключами (`EXPERIMENT_DIMENSION_KEYS`) через Structured
 * Outputs. Тематики в коде нет — контекст канала приходит данными.
 */

/** Вход построителя промпта советника: тон канала + текст инсайтов 12c. */
export interface AdvisorPromptInput {
  channelTitle: string;
  niche: string;
  toneOfVoice: string | null;
  language: string;
  /** Готовый эвристический отчёт «Рост» (`buildGrowthReport`, 12c) — источник фактов. */
  factsReport: string;
  /**
   * Подписи уже решённых измерений (непросроченная выученная стратегия 13e). Модель
   * просят предпочесть НЕ их — против схлопывания и перепроверки уже известного.
   */
  settledLabels?: readonly string[];
}

/** Готовая пара сообщений для `messages.create`. */
export interface AdvisorPrompt {
  system: string;
  user: string;
}

/** Вердикт советника после разбора JSON: какое измерение тестировать + обоснование. */
export interface AdvisorVerdict {
  dimension: ExperimentDimension;
  rationale: string;
}

/** Верхняя граница длины обоснования (короткая подсказка, не «простыня»). */
export const MAX_RATIONALE_LENGTH = 600;

/**
 * JSON-схема Structured Outputs. `dimension` ограничен ключами каталога (enum) —
 * модель не может предложить измерение, которое эксперимент не умеет запускать.
 */
export const ADVISOR_JSON_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  properties: {
    dimension: { type: "string", enum: [...EXPERIMENT_DIMENSION_KEYS] },
    rationale: { type: "string" },
  },
  required: ["dimension", "rationale"],
  additionalProperties: false,
};

const verdictSchema = z.object({
  dimension: z.enum(EXPERIMENT_DIMENSION_KEYS),
  rationale: z.string().trim().min(1).max(MAX_RATIONALE_LENGTH),
});

/**
 * Разбирает «сырой» JSON-ответ модели в вердикт. Кривой JSON / измерение вне каталога /
 * пустое или слишком длинное обоснование → `null` (мягкая деградация: советник промолчит).
 * Markdown-эмфаза (`*`/`_`) из обоснования вычищается — текст идёт на плейн-экран (правило 12c).
 */
export function parseAdvisorVerdict(raw: string): AdvisorVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = verdictSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return {
    dimension: result.data.dimension,
    rationale: result.data.rationale.replace(/[*_]/g, "").trim(),
  };
}

/** Собирает пару system/user для советника (детерминированно). */
export function buildAdvisorPrompt(input: AdvisorPromptInput): AdvisorPrompt {
  const tone = input.toneOfVoice?.trim();
  const settled = (input.settledLabels ?? []).filter((s) => s.trim() !== "");
  const catalog = EXPERIMENT_DIMENSIONS.map(
    (d) => `- ${d.dimension}: ${d.label} (${d.variants.map((v) => v.label).join(" / ")})`,
  ).join("\n");

  const system = [
    `Ты — AI-директор Telegram-канала «${input.channelTitle}» (ниша: ${input.niche}).`,
    "Владелец хочет улучшать посты через последовательные A/B-эксперименты: канал",
    "чередует 2 варианта одного измерения между постами и сравнивает вовлечённость.",
    "Твоя задача — по фактам отчёта выбрать ОДНО измерение, которое стоит проверить",
    "следующим, и коротко обосновать выбор ссылкой на факты.",
    "",
    "Измерения каталога (выбирай строго ключ отсюда):",
    catalog,
    "",
    settled.length > 0
      ? `Уже проверено (по возможности предложи другое): ${settled.join(", ")}.`
      : "",
    `Обоснование пиши на языке канала (код: ${input.language}).`,
    tone !== undefined && tone !== "" ? `Тон канала: ${tone}.` : "",
    "Опирайся ТОЛЬКО на факты отчёта — ничего не выдумывай.",
    "",
    'Верни СТРОГО JSON: {"dimension": "<ключ измерения>", "rationale": "<краткое обоснование>"}.',
  ]
    .filter((line) => line !== "")
    .join("\n");

  const user = [
    "Отчёт с фактами по каналу:",
    input.factsReport,
    "",
    "Что предложишь тестировать следующим?",
  ].join("\n");

  return { system, user };
}
