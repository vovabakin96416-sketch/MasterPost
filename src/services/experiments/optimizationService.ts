import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  getBooleanSetting,
  getJsonSetting,
  setJsonSetting,
  toggleBooleanSetting,
} from "../../db/repositories/settingRepository.js";
import {
  getActiveExperiment,
  stopActiveExperiment,
} from "../../db/repositories/experimentRepository.js";
import {
  buildStrategyDirective,
  isExplorationPost,
  parseLearnedStrategy,
  recordWinner,
  type LearnedStrategyEntry,
} from "../../core/experiments/learnedStrategy.js";
import {
  assignExperimentVariant,
  computeExperimentVerdict,
  type ExperimentDeps,
} from "./experimentService.js";

/**
 * Optimization Engine (Шаг 13e) — петля самооптимизации поверх Experiment Engine.
 *
 * Замыкает петлю плана: победитель измерения (13a–13d) записывается в «выученную
 * стратегию» канала (`Setting`, без миграции) и подмешивается в промпт генерации
 * следующих AI-постов. Чистая математика (срок годности, квота исследования, сбор
 * директивы) — в `core/experiments/learnedStrategy.ts`; здесь только хранение и
 * оркестрация. Пер-канально (SaaS: разные аудитории → разные победители).
 */

/** JSON-массив выученных записей канала. */
const LEARNED_STRATEGY_KEY = "learned_strategy";
/** Счётчик уже сгенерированных AI-постов канала — для квоты исследования (~75/25). */
const STRATEGY_COUNTER_KEY = "strategy_apply_counter";
/** Тумблер авто-применения победителя (дефолт ВЫКЛ — решение владельца). */
export const STRATEGY_AUTO_APPLY_KEY = "strategy_auto_apply";
/** По умолчанию ВЫКЛ: победитель применяется только кнопкой владельца. */
export const DEFAULT_STRATEGY_AUTO_APPLY = false;

/** Читает выученную стратегию канала (кривое значение → `[]`). */
export async function getLearnedStrategy(
  prisma: PrismaClient,
  channelId: string,
): Promise<LearnedStrategyEntry[]> {
  const raw = await getJsonSetting(prisma, channelId, LEARNED_STRATEGY_KEY);
  return parseLearnedStrategy(raw);
}

/** Читает тумблер авто-применения победителя (дефолт ВЫКЛ). */
export async function getStrategyAutoApply(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(
    prisma,
    channelId,
    STRATEGY_AUTO_APPLY_KEY,
    DEFAULT_STRATEGY_AUTO_APPLY,
  );
}

/** Переключает тумблер авто-применения и возвращает новое значение. */
export async function toggleStrategyAutoApply(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(
    prisma,
    channelId,
    STRATEGY_AUTO_APPLY_KEY,
    DEFAULT_STRATEGY_AUTO_APPLY,
  );
}

/**
 * Атомарно (для одного канала — публикация сериализована) увеличивает счётчик
 * применений и возвращает индекс ДО инкремента (его и проверяет `isExplorationPost`).
 */
async function bumpStrategyCounter(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  const raw = await getJsonSetting(prisma, channelId, STRATEGY_COUNTER_KEY);
  const current = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  await setJsonSetting(prisma, channelId, STRATEGY_COUNTER_KEY, current + 1);
  return current;
}

/** Директива и ключ варианта для генерации AI-поста (Шаг 13e). */
export interface AiGenerationDirective {
  /** Текст «Особое указание…» для `buildPostPrompt` (эксперимент + стратегия) либо null. */
  readonly variantDirective: string | null;
  /** Ключ варианта активного эксперимента для `PendingPost.variantKey` либо null. */
  readonly variantKey: string | null;
}

/**
 * Собирает директиву генерации AI-поста: вариант активного эксперимента (ротация,
 * 13c) + выученная стратегия канала (13e). Стратегия применяется НЕ к каждому посту —
 * каждый `EXPLORATION_ONE_IN`-й разведочный (без стратегии, свежие базовые данные).
 * Из стратегии исключается измерение под активным экспериментом (его диктует ротация).
 *
 * Резерв индекса ротации происходит в `assignExperimentVariant` (13c). Сбой стратегии
 * не должен ронять генерацию — блок обёрнут в try/catch (остаётся директива эксперимента).
 */
export async function resolveAiGeneration(
  deps: ExperimentDeps,
  channelId: string,
): Promise<AiGenerationDirective> {
  const assignment = await assignExperimentVariant(deps, channelId);
  let strategyDirective = "";
  try {
    const counter = await bumpStrategyCounter(deps.prisma, channelId);
    if (!isExplorationPost(counter)) {
      const active = await getActiveExperiment(deps.prisma, channelId);
      const entries = await getLearnedStrategy(deps.prisma, channelId);
      strategyDirective = buildStrategyDirective(
        entries,
        new Date(),
        active?.dimension ?? null,
      );
    }
  } catch (err) {
    deps.logger.warn({ err, channelId }, "не смог применить выученную стратегию");
  }
  const parts = [assignment?.directive ?? "", strategyDirective].filter(
    (d) => d !== "",
  );
  return {
    variantDirective: parts.length > 0 ? parts.join("\n") : null,
    variantKey: assignment?.variantKey ?? null,
  };
}

/** Результат применения победителя эксперимента (для тоста/лога/уведомления). */
export type ApplyResult =
  | {
      readonly status: "applied";
      readonly dimension: string;
      readonly variantKey: string;
      readonly dimensionLabel: string;
      readonly variantLabel: string;
    }
  | { readonly status: "suspicious" }
  | { readonly status: "not_ready" }
  | { readonly status: "no_experiment" }
  | { readonly status: "auto_off" };

/**
 * Применяет победителя активного эксперимента: если вердикт `winner` — записывает
 * победивший вариант в выученную стратегию (вытесняя прежний по этому измерению) и
 * ОСТАНАВЛИВАЕТ эксперимент (он завершён, измерение освобождено). Вердикт `suspicious`
 * (guard-метрика: отток подписчиков) НЕ применяется. Нет активного / мало данных →
 * соответствующий статус, стратегия не меняется.
 */
export async function applyExperimentWinner(
  prisma: PrismaClient,
  channelId: string,
  now: Date,
): Promise<ApplyResult> {
  const cv = await computeExperimentVerdict(prisma, channelId);
  if (cv === null) {
    return { status: "no_experiment" };
  }
  if (cv.verdict.status === "suspicious") {
    return { status: "suspicious" };
  }
  if (cv.verdict.status !== "winner") {
    return { status: "not_ready" };
  }
  const variantKey = cv.verdict.variantKey;
  const entries = await getLearnedStrategy(prisma, channelId);
  const next = recordWinner(entries, cv.experiment.dimension, variantKey, now);
  // Сериализуем в свежие изменяемые объекты (readonly-поля ядра ≠ Prisma InputJsonValue).
  const serializable = next.map((e) => ({
    dimension: e.dimension,
    variantKey: e.variantKey,
    learnedAt: e.learnedAt,
  }));
  await setJsonSetting(prisma, channelId, LEARNED_STRATEGY_KEY, serializable);
  await stopActiveExperiment(prisma, channelId);
  const variantLabel =
    cv.spec.variants.find((v) => v.key === variantKey)?.label ?? variantKey;
  return {
    status: "applied",
    dimension: cv.experiment.dimension,
    variantKey,
    dimensionLabel: cv.spec.label,
    variantLabel,
  };
}

/**
 * Авто-применение победителя (Шаг 13e) — вызывается в еженедельном джобе после сбора
 * свежих метрик. Тумблер ВЫКЛ (дефолт) → ничего не делает (`auto_off`). ВКЛ и вердикт
 * `winner` → применяет и логирует; иначе — статус без изменений стратегии.
 */
export async function maybeAutoApplyExperimentWinner(
  prisma: PrismaClient,
  logger: Logger,
  channelId: string,
  now: Date,
): Promise<ApplyResult> {
  const on = await getStrategyAutoApply(prisma, channelId);
  if (!on) {
    return { status: "auto_off" };
  }
  const result = await applyExperimentWinner(prisma, channelId, now);
  if (result.status === "applied") {
    logger.info(
      { channelId, dimension: result.dimension, variant: result.variantKey },
      "авто-применён победитель эксперимента",
    );
  }
  return result;
}
