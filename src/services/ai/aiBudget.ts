import type { PrismaClient } from "../../db/client.js";
import {
  getJsonSetting,
  setJsonSetting,
} from "../../db/repositories/settingRepository.js";
import {
  consumeDailyBudget,
  type DailyBudgetState,
} from "../../core/ai/dailyBudget.js";

/**
 * Дневной бюджет AI-вызовов на канал (Шаг 11b) — ввод-вывод поверх `Setting`.
 * Чистое решение (сброс/потолок/инкремент) — в `core/ai/dailyBudget.ts` под тестами.
 * Это переиспользуемое ограждение: 11c (AI-ответы) и 11e (классификация токсичности)
 * вызывают `tryConsumeDailyBudget` перед платным обращением к Claude.
 */

/** Ключи настроек бюджета в таблице `Setting`. */
export const AI_BUDGET_KEYS = {
  /** JSON `{ date: "YYYY-MM-DD", count }` — сколько платных вызовов сделано сегодня. */
  usage: "ai_budget_usage",
  /** JSON number — дневной потолок вызовов на канал. */
  cap: "ai_daily_cap",
} as const;

/** Потолок по умолчанию, если настройка `ai_daily_cap` не задана. */
export const DEFAULT_AI_DAILY_CAP = 50;

/** Разбирает «сырое» JSON-значение счётчика в типизированное состояние (или null). */
function parseState(raw: unknown): DailyBudgetState | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { date?: unknown }).date === "string" &&
    typeof (raw as { count?: unknown }).count === "number"
  ) {
    const r = raw as { date: string; count: number };
    return { date: r.date, count: r.count };
  }
  return null;
}

/** Читает дневной потолок канала. Кривое/отсутствующее значение → `DEFAULT_AI_DAILY_CAP`. */
export async function readDailyCap(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  const raw = await getJsonSetting(prisma, channelId, AI_BUDGET_KEYS.cap);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return DEFAULT_AI_DAILY_CAP;
  }
  return raw;
}

/**
 * Пытается списать один платный AI-вызов из дневного бюджета канала.
 * `true` → вызов разрешён (счётчик увеличен и сохранён); `false` → лимит на сегодня
 * исчерпан (или `cap=0`). `today` — дата в таймзоне канала («YYYY-MM-DD»), её
 * вычисляет вызывающий (напр. `core/schedule/localDate`). Запись обновляем только
 * при разрешении — отказ по достигнутому потолку лишних записей не делает.
 */
export async function tryConsumeDailyBudget(
  prisma: PrismaClient,
  channelId: string,
  today: string,
): Promise<boolean> {
  const cap = await readDailyCap(prisma, channelId);
  const raw = await getJsonSetting(prisma, channelId, AI_BUDGET_KEYS.usage);
  const { allowed, state } = consumeDailyBudget(parseState(raw), cap, today);
  if (allowed) {
    // Литерал (не именованный интерфейс) — Prisma.InputJsonValue требует index-сигнатуру.
    await setJsonSetting(prisma, channelId, AI_BUDGET_KEYS.usage, {
      date: state.date,
      count: state.count,
    });
  }
  return allowed;
}
