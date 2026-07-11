import { z } from "zod";
import { normalizeTriggerText } from "../triggers/matchTrigger.js";

/**
 * Построитель промпта для классификации ТОКСИЧНОСТИ коммента (Шаг 11e). ЧИСТАЯ
 * функция: по нише/тону/языку канала и тексту коммента собирает детерминированную
 * пару system/user для дешёвой модели (Haiku). Ни сети, ни SDK — покрыто тестами.
 *
 * Тематики в коде НЕТ: контекст канала приходит данными (`Channel.niche/toneOfVoice/
 * language`), поэтому один код судит токсичность для любой ниши — модель оценивает
 * враждебность ОТНОСИТЕЛЬНО этого канала и его аудитории. Владелец может дописать своё
 * правило (`policy`) — оно добавляется в system как дополнительный критерий.
 *
 * В отличие от `buildReplyPrompt` (короткий текст-ответ) здесь ждём СТРОГО JSON
 * `{ toxic, reason }` через Structured Outputs (`TOXICITY_JSON_SCHEMA`).
 */

/** Вход построителя промпта классификации токсичности. */
export interface ToxicityPromptInput {
  channelTitle: string;
  niche: string;
  toneOfVoice: string | null;
  language: string;
  /** Доп. правило канала («считать токсичным X»). Пусто → только авто-оценка по нише. */
  policy?: string;
  comment: string;
}

/** Готовая пара сообщений для `messages.create`. */
export interface ToxicityPrompt {
  system: string;
  user: string;
}

/** Вердикт классификатора после разбора JSON. */
export interface ToxicityVerdict {
  toxic: boolean;
  reason: string;
}

/** Максимум символов коммента в промпте (защита от «простыни»/расхода токенов). */
export const MAX_COMMENT_LENGTH = 500;

/**
 * JSON-схема Structured Outputs. БЕЗ minLength — как `DRAFT_JSON_SCHEMA`, длину/тип
 * проверяет zod после разбора.
 */
export const TOXICITY_JSON_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  properties: {
    toxic: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["toxic", "reason"],
  additionalProperties: false,
};

const verdictSchema = z.object({
  toxic: z.boolean(),
  reason: z.string(),
});

/**
 * Разбирает «сырой» JSON-ответ модели в вердикт. Кривой JSON / нет полей → `null`
 * (мягкая деградация, как `parseReplyText`: не смогли — считаем «не токсично», молчим).
 */
export function parseToxicityVerdict(raw: string): ToxicityVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = verdictSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Дешёвый пред-фильтр (0 токенов): стоит ли вообще звать модель. `false` для не-текста
 * (эмодзи/пунктуация → нормализация пустая) и одиночных символов. Короткие оскорбления
 * («ты дура») проходят — нормализованная длина уже ≥ 3.
 */
export function shouldCheckToxicity(text: string): boolean {
  return normalizeTriggerText(text).length >= 3;
}

/** Собирает пару system/user для классификации токсичности (детерминированно). */
export function buildToxicityPrompt(input: ToxicityPromptInput): ToxicityPrompt {
  const tone = input.toneOfVoice?.trim();
  const policy = input.policy?.trim();
  const system = [
    `Ты — модератор комментариев Telegram-канала «${input.channelTitle}» (ниша: ${input.niche}).`,
    "Оцени, токсичен ли комментарий читателя: враждебность, оскорбления, травля,",
    "агрессия или нападки на автора канала, на других читателей или на саму тематику канала.",
    "Оценивай в КОНТЕКСТЕ ниши и аудитории этого канала.",
    "",
    "Не считай токсичной вежливую критику, сомнение или несогласие по существу.",
    tone !== undefined && tone !== ""
      ? `Тон канала (для контекста): ${tone}.`
      : "",
    policy !== undefined && policy !== ""
      ? `Дополнительно для этого канала считать токсичным: ${policy}.`
      : "",
    `Язык комментариев — код: ${input.language}.`,
    "",
    'Верни СТРОГО JSON: {"toxic": true|false, "reason": "краткая причина на языке канала"}.',
    "reason — короткое пояснение (для не токсичных можно пустую строку).",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const user = ["Комментарий читателя:", input.comment].join("\n");

  return { system, user };
}
