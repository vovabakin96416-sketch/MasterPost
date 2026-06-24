import type { PrismaClient } from "../db/client.js";
import {
  getBooleanSetting,
  getStringSetting,
  setStringSetting,
  toggleBooleanSetting,
} from "../db/repositories/settingRepository.js";
import type {
  LastPosted,
  ScheduleTimes,
  SlotName,
} from "../core/schedule/dueSlots.js";

/**
 * Настройки автопостинга (Шаг 4) поверх таблицы `Setting`. Здесь живут ключи и
 * дефолты, чтобы и планировщик (читает), и меню админа (читает/пишет) пользовались
 * одним источником. Тематики нет — это общие настройки любого канала.
 */

export const AUTOPOST_KEYS = {
  enabled: "autopost_enabled",
  morningTime: "morning_time",
  eveningTime: "evening_time",
  lastMorning: "last_post_morning",
  lastEvening: "last_post_evening",
} as const;

/** Дефолты времён слотов — как в Python-боте (10:00 / 20:00). */
export const DEFAULT_TIMES: ScheduleTimes = { morning: "10:00", evening: "20:00" };

/** По умолчанию автопостинг ВЫКЛ — ничего не уходит само, пока админ не включит. */
export const DEFAULT_ENABLED = false;

export interface AutopostConfig {
  enabled: boolean;
  times: ScheduleTimes;
  last: LastPosted;
}

/** Читает полную конфигурацию автопостинга канала за один проход. */
export async function readAutopostConfig(
  prisma: PrismaClient,
  channelId: string,
): Promise<AutopostConfig> {
  const [enabled, morning, evening, lastMorning, lastEvening] = await Promise.all([
    getBooleanSetting(prisma, channelId, AUTOPOST_KEYS.enabled, DEFAULT_ENABLED),
    getStringSetting(prisma, channelId, AUTOPOST_KEYS.morningTime, DEFAULT_TIMES.morning),
    getStringSetting(prisma, channelId, AUTOPOST_KEYS.eveningTime, DEFAULT_TIMES.evening),
    getStringSetting(prisma, channelId, AUTOPOST_KEYS.lastMorning, null),
    getStringSetting(prisma, channelId, AUTOPOST_KEYS.lastEvening, null),
  ]);
  return {
    enabled,
    times: {
      morning: morning ?? DEFAULT_TIMES.morning,
      evening: evening ?? DEFAULT_TIMES.evening,
    },
    last: { morning: lastMorning, evening: lastEvening },
  };
}

/** Ключ настройки времени по слоту. */
function timeKey(slot: SlotName): string {
  return slot === "morning" ? AUTOPOST_KEYS.morningTime : AUTOPOST_KEYS.eveningTime;
}

/** Ключ настройки «последняя публикация» по слоту. */
function lastKey(slot: SlotName): string {
  return slot === "morning" ? AUTOPOST_KEYS.lastMorning : AUTOPOST_KEYS.lastEvening;
}

/** Сохраняет время публикации слота (нормализованное "HH:MM"). */
export async function setSlotTime(
  prisma: PrismaClient,
  channelId: string,
  slot: SlotName,
  value: string,
): Promise<void> {
  await setStringSetting(prisma, channelId, timeKey(slot), value);
}

/** Отмечает, что слот опубликован (или обработан) в указанную локальную дату. */
export async function markSlotPosted(
  prisma: PrismaClient,
  channelId: string,
  slot: SlotName,
  isoDate: string,
): Promise<void> {
  await setStringSetting(prisma, channelId, lastKey(slot), isoDate);
}

/** Переключает автопостинг и возвращает новое значение. */
export async function toggleAutopost(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(prisma, channelId, AUTOPOST_KEYS.enabled, DEFAULT_ENABLED);
}
