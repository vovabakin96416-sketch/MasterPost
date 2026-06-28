import type { PrismaClient } from "../db/client.js";
import {
  getJsonSetting,
  setJsonSetting,
} from "../db/repositories/settingRepository.js";

/**
 * Настройка кулдауна триггеров (часов) поверх таблицы `Setting`. Один источник для
 * логики триггеров (читает) и меню админа (читает/пишет). Тематики нет — общая
 * настройка любого канала.
 *
 * Значение `0` валидно и означает «кулдаун выключен»: `nextExpiry(now, 0)` даёт
 * уже истёкший момент, поэтому триггер срабатывает без задержки.
 */

export const COOLDOWN_KEY = "cooldown_hours";

/** Дефолт, если кулдаун ни разу не задавали (как было захардкожено). */
export const DEFAULT_COOLDOWN_HOURS = 24;

/** Читает кулдаун (часов) или дефолт, если запись не задана/повреждена. */
export async function readCooldownHours(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  const raw = await getJsonSetting(prisma, channelId, COOLDOWN_KEY);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return DEFAULT_COOLDOWN_HOURS;
  }
  return raw;
}

/** Сохраняет кулдаун (часов) для канала. */
export async function setCooldownHours(
  prisma: PrismaClient,
  channelId: string,
  hours: number,
): Promise<void> {
  await setJsonSetting(prisma, channelId, COOLDOWN_KEY, hours);
}
