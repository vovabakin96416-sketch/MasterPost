import { z } from "zod";
import type { PrismaClient } from "../db/client.js";
import {
  getBooleanSetting,
  getJsonSetting,
  setJsonSetting,
  toggleBooleanSetting,
} from "../db/repositories/settingRepository.js";
import { sortTimes, type Progress } from "../core/schedule/times.js";

/**
 * Настройки автопостинга (Доработка 4.1) поверх таблицы `Setting`. Здесь живут ключи
 * и дефолты, чтобы планировщик (читает) и меню админа (читает/пишет) пользовались
 * одним источником. Тематики нет — это общие настройки любого канала.
 *
 * Вместо двух слотов «утро/вечер» — произвольный СПИСОК времён публикации на день.
 */

export const AUTOPOST_KEYS = {
  enabled: "autopost_enabled",
  times: "autopost_times", // JSON: ["09:00","13:30","20:00"]
  progress: "autopost_progress", // JSON: { date, postedTimes }
} as const;

/** Дефолтные времена, если список ни разу не задавали. */
export const DEFAULT_TIMES: readonly string[] = ["10:00", "20:00"];

/** По умолчанию автопостинг ВЫКЛ — ничего не уходит само, пока админ не включит. */
export const DEFAULT_ENABLED = false;

const timesSchema = z.array(z.string());
const progressSchema = z.object({
  date: z.string().nullable(),
  postedTimes: z.array(z.string()),
});

const EMPTY_PROGRESS: Progress = { date: null, postedTimes: [] };

export interface AutopostConfig {
  enabled: boolean;
  times: string[]; // отсортированы, без дублей
  progress: Progress;
}

/** Читает список времён (отсортированный) или дефолт, если запись не задавалась. */
async function readTimes(prisma: PrismaClient, channelId: string): Promise<string[]> {
  const raw = await getJsonSetting(prisma, channelId, AUTOPOST_KEYS.times);
  if (raw === undefined) {
    return sortTimes(DEFAULT_TIMES);
  }
  const parsed = timesSchema.safeParse(raw);
  return sortTimes(parsed.success ? parsed.data : []);
}

/** Читает полную конфигурацию автопостинга канала. */
export async function readAutopostConfig(
  prisma: PrismaClient,
  channelId: string,
): Promise<AutopostConfig> {
  const [enabled, times, rawProgress] = await Promise.all([
    getBooleanSetting(prisma, channelId, AUTOPOST_KEYS.enabled, DEFAULT_ENABLED),
    readTimes(prisma, channelId),
    getJsonSetting(prisma, channelId, AUTOPOST_KEYS.progress),
  ]);
  const progress =
    rawProgress === undefined
      ? EMPTY_PROGRESS
      : (progressSchema.safeParse(rawProgress).data ?? EMPTY_PROGRESS);
  return { enabled, times, progress };
}

/** Добавляет время в список (дедуп + сортировка). */
export async function addTime(
  prisma: PrismaClient,
  channelId: string,
  value: string,
): Promise<void> {
  const current = await readTimes(prisma, channelId);
  const next = sortTimes([...current, value]);
  await setJsonSetting(prisma, channelId, AUTOPOST_KEYS.times, next);
}

/** Удаляет время по индексу в отсортированном списке (как показано в меню). */
export async function removeTimeAt(
  prisma: PrismaClient,
  channelId: string,
  index: number,
): Promise<void> {
  const current = await readTimes(prisma, channelId);
  if (index < 0 || index >= current.length) {
    return;
  }
  current.splice(index, 1);
  await setJsonSetting(prisma, channelId, AUTOPOST_KEYS.times, current);
}

/** Сохраняет прогресс публикаций за день (дата + отработанные времена). */
export async function saveProgress(
  prisma: PrismaClient,
  channelId: string,
  progress: Progress,
): Promise<void> {
  await setJsonSetting(prisma, channelId, AUTOPOST_KEYS.progress, {
    date: progress.date,
    postedTimes: [...progress.postedTimes],
  });
}

/** Переключает автопостинг и возвращает новое значение. */
export async function toggleAutopost(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(prisma, channelId, AUTOPOST_KEYS.enabled, DEFAULT_ENABLED);
}
