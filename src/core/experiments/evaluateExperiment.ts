/**
 * Вердикт эксперимента (Шаг 13a) — ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Сравнение вариантов по среднему ERR с двумя предохранителями против нейрослопа:
 * 1. Фильтр выбросов (реюз 12a/12f): рекламный/виральный пост не делает вариант
 *    «победителем» — просмотры пулятся по ВСЕМ вариантам (общая медиана канала),
 *    выбросы исключаются из агрегатов.
 * 2. Guard-метрика: победитель по ERR при ПАДАЮЩИХ подписчиках за период эксперимента
 *    → вердикт `suspicious` (высокая вовлечённость ценой оттока — кликбейт), слой
 *    применения стратегии (13e) такой вариант НЕ применяет.
 */

import { engagementRate, type EngagementLike } from "../analytics/engagement.js";
import { flagViewOutliers } from "../analytics/outliers.js";

/** Минимум чистых (без выбросов) постов на вариант для вердикта. */
export const MIN_POSTS_PER_VARIANT = 5;

/** Минимальная разница ERR (%) между лучшим и вторым, чтобы объявить победителя. */
export const WINNER_THRESHOLD_PCT = 15;

/** Выборка одного варианта: ключ + посты, опубликованные с этим вариантом. */
export interface VariantSample {
  readonly key: string;
  readonly posts: readonly EngagementLike[];
}

/** Агрегат варианта после фильтра выбросов. */
export interface VariantResult {
  readonly key: string;
  readonly cleanCount: number;
  readonly avgErr: number;
}

/**
 * Вердикт: `continue` — данных мало (нужно ещё ~postsNeeded постов) · `no_difference` —
 * разница ниже порога · `winner` — есть победитель (deltaPct null = ERR второго 0,
 * базы для % нет) · `suspicious` — победитель есть, но подписчики за период падали.
 */
export type ExperimentVerdict =
  | {
      readonly status: "continue";
      readonly results: readonly VariantResult[];
      readonly postsNeeded: number;
    }
  | {
      readonly status: "no_difference";
      readonly results: readonly VariantResult[];
      readonly deltaPct: number;
    }
  | {
      readonly status: "winner" | "suspicious";
      readonly results: readonly VariantResult[];
      readonly variantKey: string;
      readonly deltaPct: number | null;
    };

/** Агрегаты вариантов: общий пул просмотров → флаги выбросов → чистый средний ERR. */
function buildResults(samples: readonly VariantSample[]): VariantResult[] {
  const pooledViews = samples.flatMap((s) => s.posts.map((p) => p.views));
  const flags = flagViewOutliers(pooledViews);
  const results: VariantResult[] = [];
  let offset = 0;
  for (const sample of samples) {
    const clean = sample.posts.filter((_, i) => !(flags[offset + i] ?? false));
    offset += sample.posts.length;
    const avgErr =
      clean.length === 0
        ? 0
        : clean.reduce((sum, p) => sum + engagementRate(p), 0) / clean.length;
    results.push({ key: sample.key, cleanCount: clean.length, avgErr });
  }
  return results;
}

/**
 * Вердикт эксперимента по выборкам вариантов. `subscriberDelta` — изменение числа
 * подписчиков за период эксперимента (guard-метрика; null/не передан — проверка
 * пропускается, вердикт без подозрений).
 */
export function evaluateExperiment(
  samples: readonly VariantSample[],
  subscriberDelta?: number | null,
): ExperimentVerdict {
  const results = buildResults(samples);
  const shortfall = results.reduce(
    (sum, r) => sum + Math.max(0, MIN_POSTS_PER_VARIANT - r.cleanCount),
    0,
  );
  if (results.length < 2 || shortfall > 0) {
    return { status: "continue", results, postsNeeded: Math.max(shortfall, 1) };
  }

  const ranked = [...results].sort((a, b) => b.avgErr - a.avgErr);
  const best = ranked[0];
  const second = ranked[1];
  if (best === undefined || second === undefined) {
    return { status: "continue", results, postsNeeded: 1 };
  }

  if (second.avgErr === 0) {
    if (best.avgErr === 0) {
      return { status: "no_difference", results, deltaPct: 0 };
    }
    return withGuard(results, best.key, null, subscriberDelta);
  }

  const deltaPct = ((best.avgErr - second.avgErr) / second.avgErr) * 100;
  if (deltaPct < WINNER_THRESHOLD_PCT) {
    return { status: "no_difference", results, deltaPct };
  }
  return withGuard(results, best.key, deltaPct, subscriberDelta);
}

/** Победитель есть; при оттоке подписчиков за период — понижаем до `suspicious`. */
function withGuard(
  results: readonly VariantResult[],
  variantKey: string,
  deltaPct: number | null,
  subscriberDelta: number | null | undefined,
): ExperimentVerdict {
  const suspicious = typeof subscriberDelta === "number" && subscriberDelta < 0;
  return { status: suspicious ? "suspicious" : "winner", results, variantKey, deltaPct };
}
