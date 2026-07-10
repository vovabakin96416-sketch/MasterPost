import { z } from "zod";
import type { PrismaClient } from "../../db/client.js";
import {
  getBooleanSetting,
  getJsonSetting,
  setJsonSetting,
  toggleBooleanSetting,
} from "../../db/repositories/settingRepository.js";

/**
 * Настройки AI-ответов в комментах (Шаг 11c) поверх таблицы `Setting`. Отдельный
 * набор AI-триггеров (пул готовых текстов не трогаем) и тумблер фичи. Здесь живут
 * ключи и дефолты, чтобы стадия комментов (читает) и меню админа (читает/пишет)
 * пользовались одним источником. Тематики нет — общие настройки любого канала.
 */

export const AI_REPLY_KEYS = {
  /** boolean — включён ли AI-ответ в комментах (дефолт false). */
  enabled: "ai_reply_enabled",
  /** JSON string[] — отдельный набор слов-триггеров для AI-ответа. */
  triggerWords: "ai_trigger_words",
} as const;

/** По умолчанию AI-ответы ВЫКЛ — фича молчит и не тратит токены, пока не включат. */
export const DEFAULT_AI_REPLY_ENABLED = false;

const triggerWordsSchema = z.array(z.string());

/** Читает тумблер AI-ответов канала (дефолт false). */
export async function getAiReplyEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    AI_REPLY_KEYS.enabled,
    DEFAULT_AI_REPLY_ENABLED,
  );
}

/** Переключает тумблер AI-ответов и возвращает новое значение. */
export async function toggleAiReplyEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    AI_REPLY_KEYS.enabled,
    DEFAULT_AI_REPLY_ENABLED,
  );
}

/** Читает набор AI-триггеров канала. Кривой/отсутствующий JSON → пустой список. */
export async function getAiTriggerWords(
  prisma: PrismaClient,
  channelId: string,
): Promise<string[]> {
  const raw = await getJsonSetting(prisma, channelId, AI_REPLY_KEYS.triggerWords);
  const parsed = triggerWordsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Добавляет слово в набор AI-триггеров (идемпотентно — без дублей). */
export async function addAiTriggerWord(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  const words = await getAiTriggerWords(prisma, channelId);
  if (words.includes(word)) {
    return;
  }
  await setJsonSetting(prisma, channelId, AI_REPLY_KEYS.triggerWords, [
    ...words,
    word,
  ]);
}

/** Удаляет слово из набора AI-триггеров (по точному совпадению исходной формы). */
export async function removeAiTriggerWord(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  const words = await getAiTriggerWords(prisma, channelId);
  const next = words.filter((w) => w !== word);
  if (next.length === words.length) {
    return;
  }
  await setJsonSetting(prisma, channelId, AI_REPLY_KEYS.triggerWords, next);
}
