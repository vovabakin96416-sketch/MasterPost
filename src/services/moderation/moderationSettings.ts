import { z } from "zod";
import type { PrismaClient } from "../../db/client.js";
import {
  getBooleanSetting,
  getJsonSetting,
  setJsonSetting,
  toggleBooleanSetting,
} from "../../db/repositories/settingRepository.js";

/**
 * Настройки модерации комментов (Шаг 11d) поверх таблицы `Setting`. Здесь живут
 * ключи и дефолты, чтобы стадия модерации (читает) и меню админа (читает/пишет)
 * пользовались одним источником — как `aiReplySettings` для AI-ответов.
 *
 * Дешёвая модерация без AI: тумблер фичи, тумблер авто-удаления и список
 * стоп-слов. Тематики нет — общие настройки любого канала. Дефолт всё ВЫКЛ:
 * фича молчит и ничего не трогает, пока владелец её не включит.
 */

export const MODERATION_KEYS = {
  /** boolean — включена ли модерация комментов (дефолт false). */
  enabled: "moderation_enabled",
  /** boolean — авто-удалять спам (нужны права бота; дефолт false). */
  delete: "moderation_delete",
  /** JSON string[] — стоп-слова канала. */
  stopWords: "moderation_stopwords",
} as const;

/** По умолчанию модерация ВЫКЛ. */
export const DEFAULT_MODERATION_ENABLED = false;
/** По умолчанию авто-удаление ВЫКЛ — безопасный дефолт «только сигнал админу». */
export const DEFAULT_MODERATION_DELETE = false;

const stopWordsSchema = z.array(z.string());

/** Читает тумблер модерации канала (дефолт false). */
export async function getModerationEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    MODERATION_KEYS.enabled,
    DEFAULT_MODERATION_ENABLED,
  );
}

/** Переключает тумблер модерации и возвращает новое значение. */
export async function toggleModerationEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    MODERATION_KEYS.enabled,
    DEFAULT_MODERATION_ENABLED,
  );
}

/** Читает тумблер авто-удаления спама (дефолт false). */
export async function getModerationDelete(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    MODERATION_KEYS.delete,
    DEFAULT_MODERATION_DELETE,
  );
}

/** Переключает тумблер авто-удаления и возвращает новое значение. */
export async function toggleModerationDelete(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    MODERATION_KEYS.delete,
    DEFAULT_MODERATION_DELETE,
  );
}

/** Читает список стоп-слов канала. Кривой/отсутствующий JSON → пустой список. */
export async function getStopWords(
  prisma: PrismaClient,
  channelId: string,
): Promise<string[]> {
  const raw = await getJsonSetting(prisma, channelId, MODERATION_KEYS.stopWords);
  const parsed = stopWordsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Добавляет стоп-слово (идемпотентно — без дублей). */
export async function addStopWord(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  const words = await getStopWords(prisma, channelId);
  if (words.includes(word)) {
    return;
  }
  await setJsonSetting(prisma, channelId, MODERATION_KEYS.stopWords, [
    ...words,
    word,
  ]);
}

/** Удаляет стоп-слово (по точному совпадению исходной формы). */
export async function removeStopWord(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  const words = await getStopWords(prisma, channelId);
  const next = words.filter((w) => w !== word);
  if (next.length === words.length) {
    return;
  }
  await setJsonSetting(prisma, channelId, MODERATION_KEYS.stopWords, next);
}
