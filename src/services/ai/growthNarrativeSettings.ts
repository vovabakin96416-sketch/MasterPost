import type { PrismaClient } from "../../db/client.js";
import {
  getBooleanSetting,
  toggleBooleanSetting,
} from "../../db/repositories/settingRepository.js";

/**
 * Настройка AI-пересказа отчёта «Рост» (Шаг 12d) поверх таблицы `Setting`.
 * Отдельный тумблер (как `moderation_toxicity_enabled` в 11e): фича платная
 * (Haiku, бюджет общий с AI-ответами), поэтому по умолчанию ВЫКЛ — пока не
 * включат, экран и отчёт показывают бесплатный эвристический текст 12c.
 */

/** Ключ тумблера в таблице `Setting` (boolean). */
export const GROWTH_NARRATIVE_KEY = "growth_narrative_enabled";

/** По умолчанию ВЫКЛ — пересказ молчит и не тратит токены, пока не включат. */
export const DEFAULT_GROWTH_NARRATIVE_ENABLED = false;

/** Читает тумблер AI-пересказа роста канала (дефолт false). */
export async function getGrowthNarrativeEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    GROWTH_NARRATIVE_KEY,
    DEFAULT_GROWTH_NARRATIVE_ENABLED,
  );
}

/** Переключает тумблер AI-пересказа роста и возвращает новое значение. */
export async function toggleGrowthNarrativeEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    GROWTH_NARRATIVE_KEY,
    DEFAULT_GROWTH_NARRATIVE_ENABLED,
  );
}
