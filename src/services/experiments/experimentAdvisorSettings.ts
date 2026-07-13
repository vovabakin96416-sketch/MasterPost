import type { PrismaClient } from "../../db/client.js";
import {
  getBooleanSetting,
  toggleBooleanSetting,
} from "../../db/repositories/settingRepository.js";

/**
 * Настройка AI-советника экспериментов (Шаг 13f) поверх таблицы `Setting`.
 * Отдельный тумблер (как `growth_narrative_enabled` в 12d): фича платная (Haiku,
 * бюджет общий с AI-ответами), поэтому по умолчанию ВЫКЛ — пока не включат, кнопки
 * «что тестировать?» на экране «🧪 Эксперименты» нет и токены не тратятся.
 */

/** Ключ тумблера в таблице `Setting` (boolean). */
export const EXPERIMENT_ADVISOR_KEY = "experiment_advisor_enabled";

/** По умолчанию ВЫКЛ — советник молчит и не тратит токены, пока не включат. */
export const DEFAULT_EXPERIMENT_ADVISOR_ENABLED = false;

/** Читает тумблер AI-советника экспериментов канала (дефолт false). */
export async function getExperimentAdvisorEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    EXPERIMENT_ADVISOR_KEY,
    DEFAULT_EXPERIMENT_ADVISOR_ENABLED,
  );
}

/** Переключает тумблер AI-советника экспериментов и возвращает новое значение. */
export async function toggleExperimentAdvisorEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    EXPERIMENT_ADVISOR_KEY,
    DEFAULT_EXPERIMENT_ADVISOR_ENABLED,
  );
}
