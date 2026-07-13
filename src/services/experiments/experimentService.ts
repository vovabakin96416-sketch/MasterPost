import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  getActiveExperiment,
  takeNextVariantIndex,
} from "../../db/repositories/experimentRepository.js";
import { listVariantMetricsSince } from "../../db/repositories/postMetricRepository.js";
import { getSubscriberDeltaSince } from "../../db/repositories/channelStatSnapshotRepository.js";
import { assignVariant } from "../../core/experiments/assignVariant.js";
import { getDimensionSpec } from "../../core/experiments/experiment.js";
import { evaluateExperiment } from "../../core/experiments/evaluateExperiment.js";
import { buildExperimentReport } from "../../core/experiments/experimentReport.js";
import { localDateParts } from "../../core/schedule/localDate.js";

/**
 * Сервис экспериментов (Шаг 13b/13c) — оркестрация поверх ядра 13a и репозитория.
 *
 * Задача: при сборке AI-поста назначить ему вариант активного эксперимента
 * (детерминированная ротация) и отдать вызывающему И ключ (для `variantKey`), И
 * директиву (для промпта генерации, 13c). Экран/отчёт/вердикт — подшаги 13d–13e.
 */

/** Что нужно для назначения варианта: БД + логгер (ошибку глотаем, не роняем пост). */
export interface ExperimentDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
}

/**
 * Назначение варианта AI-посту: `variantKey` сохраняется в очереди, `directive`
 * подмешивается в промпт генерации (Шаг 13c). Возвращается вместе, чтобы генерация
 * и хранение опирались на ОДИН зарезервированный индекс ротации.
 */
export interface ExperimentAssignment {
  readonly variantKey: string;
  readonly directive: string;
}

/**
 * Назначает следующий вариант активного эксперимента канала. Нет активного
 * эксперимента / неизвестное измерение → `null` (пост генерируется и публикуется
 * вне эксперимента).
 *
 * Ротацию двигаем ТОЛЬКО когда реально есть куда назначить: `takeNextVariantIndex`
 * вызывается после проверки спецификации измерения. Резерв индекса происходит ДО
 * генерации (13c: директива нужна промпту) — редкая неудача генерации «съедает»
 * один индекс ротации, но паритет самовосстанавливается, а вердикт (13d) считает
 * реальные метрики, не счётчик. Любая ошибка (гонка, БД) → лог + `null`: назначение
 * варианта не должно ронять публикацию.
 */
export async function assignExperimentVariant(
  deps: ExperimentDeps,
  channelId: string,
): Promise<ExperimentAssignment | null> {
  try {
    const experiment = await getActiveExperiment(deps.prisma, channelId);
    if (experiment === null) {
      return null;
    }
    const spec = getDimensionSpec(experiment.dimension);
    if (spec === null) {
      deps.logger.warn(
        { channelId, dimension: experiment.dimension },
        "эксперимент ссылается на неизвестное измерение — вариант не назначен",
      );
      return null;
    }
    const index = await takeNextVariantIndex(deps.prisma, experiment.id);
    const variant = assignVariant(spec.variants, index);
    if (variant === null) {
      return null;
    }
    deps.logger.info(
      { channelId, dimension: experiment.dimension, variant: variant.key, index },
      "AI-посту назначен вариант эксперимента",
    );
    return { variantKey: variant.key, directive: variant.directive };
  } catch (err) {
    deps.logger.warn({ err, channelId }, "не смог назначить вариант эксперимента");
    return null;
  }
}

/**
 * Прогресс активного эксперимента канала текстом (Шаг 13d) — для экрана «🧪 Эксперименты»
 * и секции еженедельного отчёта. Читает снимки метрик постов эксперимента (с `since =
 * startedAt`), группирует по вариантам, считает вердикт 13a (с guard-метрикой по Δ
 * подписчиков за период) и форматирует чистым текстом (реюз `buildExperimentReport`).
 *
 * Нет активного эксперимента / измерение выпало из каталога → null (секции/тела нет).
 * `now` не нужен: окно эксперимента задаёт `startedAt`, а не «последние N дней».
 */
export async function buildExperimentProgress(
  prisma: PrismaClient,
  channelId: string,
  timezone: string,
): Promise<string | null> {
  const experiment = await getActiveExperiment(prisma, channelId);
  if (experiment === null) {
    return null;
  }
  const spec = getDimensionSpec(experiment.dimension);
  if (spec === null) {
    return null;
  }
  const metrics = await listVariantMetricsSince(prisma, channelId, experiment.startedAt);
  const samples = spec.variants.map((v) => ({
    key: v.key,
    posts: metrics.filter((m) => m.variantKey === v.key),
  }));
  const subscriberDelta = await getSubscriberDeltaSince(
    prisma,
    channelId,
    experiment.startedAt,
  );
  const verdict = evaluateExperiment(samples, subscriberDelta);
  const variantLabels: Record<string, string> = {};
  for (const v of spec.variants) {
    variantLabels[v.key] = v.label;
  }
  const iso = localDateParts(experiment.startedAt, timezone).isoDate; // «YYYY-MM-DD»
  const startedLabel = `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return buildExperimentReport({
    dimensionLabel: spec.label,
    startedLabel,
    variantLabels,
    verdict,
  });
}
