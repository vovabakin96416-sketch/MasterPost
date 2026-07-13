/**
 * Выученная стратегия канала (Шаг 13e) — ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Optimization Engine замыкает петлю эксперимента: победитель измерения (13a–13d)
 * записывается в «выученную стратегию» канала и подмешивается в промпт генерации
 * следующих постов (директива варианта из каталога 13a). Здесь только математика:
 * разбор/срок годности записей, сбор директивы, квота исследования. Хранение в
 * `Setting` и оркестрация — в `services/experiments/optimizationService.ts`.
 *
 * Предохранители против нейрослопа (план 13):
 * - СРОК ГОДНОСТИ: выученный победитель живёт `STRATEGY_TTL_WEEKS` недель, потом
 *   считается устаревшим (не применяется, предлагается перепроверка).
 * - КВОТА ИССЛЕДОВАНИЯ: каждый `EXPLORATION_ONE_IN`-й пост генерируется БЕЗ стратегии
 *   (~75/25) — против схлопывания в один стиль и ради свежих базовых данных.
 */

import { z } from "zod";
import { EXPERIMENT_DIMENSIONS, getDimensionSpec } from "./experiment.js";
import { pluralRu } from "../text/pluralRu.js";

/** Выученная запись: измерение → победивший вариант + когда выучен (ISO 8601). */
export interface LearnedStrategyEntry {
  readonly dimension: string;
  readonly variantKey: string;
  readonly learnedAt: string;
}

/** Срок годности победителя в неделях (потом — перепроверка). */
export const STRATEGY_TTL_WEEKS = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Срок годности в миллисекундах. */
export const STRATEGY_TTL_MS = STRATEGY_TTL_WEEKS * WEEK_MS;

/** Каждый `EXPLORATION_ONE_IN`-й пост — разведочный (без стратегии). 4 → ~75/25. */
export const EXPLORATION_ONE_IN = 4;

const ENTRY_SCHEMA = z.object({
  dimension: z.string().min(1),
  variantKey: z.string().min(1),
  learnedAt: z.string().min(1),
});
const STRATEGY_SCHEMA = z.array(ENTRY_SCHEMA);

/** Разбирает сырое JSON-значение настройки в массив записей; кривое → `[]`. */
export function parseLearnedStrategy(raw: unknown): LearnedStrategyEntry[] {
  const parsed = STRATEGY_SCHEMA.safeParse(raw);
  return parsed.success ? [...parsed.data] : [];
}

/** Просрочена ли запись на момент `now` (кривая дата → считаем просроченной). */
export function isStrategyExpired(entry: LearnedStrategyEntry, now: Date): boolean {
  const learned = Date.parse(entry.learnedAt);
  if (Number.isNaN(learned)) {
    return true;
  }
  return now.getTime() - learned >= STRATEGY_TTL_MS;
}

/** Сколько дней осталось до устаревания (0, если уже устарела). */
export function strategyDaysLeft(entry: LearnedStrategyEntry, now: Date): number {
  const learned = Date.parse(entry.learnedAt);
  if (Number.isNaN(learned)) {
    return 0;
  }
  const leftMs = learned + STRATEGY_TTL_MS - now.getTime();
  return leftMs <= 0 ? 0 : Math.ceil(leftMs / DAY_MS);
}

/**
 * Записывает/заменяет победителя измерения (ОДНА запись на измерение — новый
 * победитель вытесняет прежний, срок годности отсчитывается заново от `now`).
 */
export function recordWinner(
  entries: readonly LearnedStrategyEntry[],
  dimension: string,
  variantKey: string,
  now: Date,
): LearnedStrategyEntry[] {
  const rest = entries.filter((e) => e.dimension !== dimension);
  return [...rest, { dimension, variantKey, learnedAt: now.toISOString() }];
}

/**
 * Разведочный ли это пост по счётчику уже применённых стратегий. Каждый
 * `EXPLORATION_ONE_IN`-й (последний в окне) — да: стратегию НЕ применяем, копим
 * свежие базовые данные. Детерминированная ротация = ровно 25% исследования.
 */
export function isExplorationPost(counter: number): boolean {
  return counter % EXPLORATION_ONE_IN === EXPLORATION_ONE_IN - 1;
}

/**
 * Собирает директиву применяемой стратегии для промпта генерации: непросроченные
 * записи (кроме измерения `excludeDimension` — оно сейчас под активным экспериментом,
 * его вариант диктует ротация) → директивы вариантов из каталога 13a, склеенные `\n`.
 * Нет применимых записей → `""` (блока в промпте не будет).
 */
export function buildStrategyDirective(
  entries: readonly LearnedStrategyEntry[],
  now: Date,
  excludeDimension?: string | null,
): string {
  const directives: string[] = [];
  for (const entry of entries) {
    if (excludeDimension != null && entry.dimension === excludeDimension) {
      continue;
    }
    if (isStrategyExpired(entry, now)) {
      continue;
    }
    const spec = getDimensionSpec(entry.dimension);
    if (spec === null) {
      continue;
    }
    const variant = spec.variants.find((v) => v.key === entry.variantKey);
    if (variant === undefined) {
      continue;
    }
    directives.push(variant.directive);
  }
  return directives.join("\n");
}

/**
 * Плейн-текст сводки выученной стратегии для экрана «🧪 Эксперименты» и отчёта:
 * по строке на измерение с записью — подпись варианта + остаток срока годности либо
 * пометка «устарел». Записей нет → одна поясняющая строка. Порядок — как в каталоге.
 *
 * ⚠️ БЕЗ Markdown-эмфазы (правило 12c) — тот же текст идёт и на экран, и в отчёт.
 */
export function buildStrategySummary(
  entries: readonly LearnedStrategyEntry[],
  now: Date,
): string {
  if (entries.length === 0) {
    return "Выученных предпочтений пока нет.";
  }
  const lines: string[] = [];
  for (const spec of EXPERIMENT_DIMENSIONS) {
    const entry = entries.find((e) => e.dimension === spec.dimension);
    if (entry === undefined) {
      continue;
    }
    const variant = spec.variants.find((v) => v.key === entry.variantKey);
    const variantLabel = variant?.label ?? entry.variantKey;
    if (isStrategyExpired(entry, now)) {
      lines.push(`${spec.label}: ${variantLabel} (устарел — перепроверь)`);
    } else {
      const days = strategyDaysLeft(entry, now);
      lines.push(
        `${spec.label}: ${variantLabel} (ещё ${String(days)} ${pluralRu(days, ["день", "дня", "дней"])})`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "Выученных предпочтений пока нет.";
}
