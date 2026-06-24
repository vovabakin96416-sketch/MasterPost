import type { PrismaClient } from "../client.js";

/**
 * Доступ к настройкам канала (таблица `Setting`, замена settings.json).
 * Чтение нужно триггерам (Шаг 2, `comments_enabled`); запись/тумблеры — меню
 * админа (Шаг 3).
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

/** Записывает булеву настройку (upsert по паре channelId+key). Шаг 3. */
export async function setBooleanSetting(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  value: boolean,
): Promise<void> {
  await prisma.setting.upsert({
    where: { channelId_key: { channelId, key } },
    create: { channelId, key, value },
    update: { value },
  });
}

/**
 * Переключает булеву настройку и возвращает новое значение. Тумблеры меню
 * (`comments_enabled` и т.п.). `defaultValue` — что считать текущим, если записи
 * ещё нет (для `comments_enabled` это `true`, как в Python DEFAULT_SETTINGS).
 */
export async function toggleBooleanSetting(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  defaultValue: boolean,
): Promise<boolean> {
  const current = await getBooleanSetting(prisma, channelId, key, defaultValue);
  const next = !current;
  await setBooleanSetting(prisma, channelId, key, next);
  return next;
}
