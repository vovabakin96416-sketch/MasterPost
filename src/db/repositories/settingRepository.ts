import type { PrismaClient } from "../client.js";

/**
 * Доступ к настройкам канала (таблица `Setting`, замена settings.json).
 * Полноценное управление настройками — Шаг 3 (adminMenu); здесь только чтение,
 * нужное триггерам (`comments_enabled`).
 */

/**
 * Читает булеву настройку. Если записи нет или значение не булево — возвращает
 * `defaultValue`. По умолчанию `comments_enabled` считаем включённым (как в
 * Python: `DEFAULT_SETTINGS["comments_enabled"] = True`).
 */
export async function getBooleanSetting(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  defaultValue: boolean,
): Promise<boolean> {
  const row = await prisma.setting.findUnique({
    where: { channelId_key: { channelId, key } },
    select: { value: true },
  });
  if (!row) {
    return defaultValue;
  }
  return typeof row.value === "boolean" ? row.value : defaultValue;
}
