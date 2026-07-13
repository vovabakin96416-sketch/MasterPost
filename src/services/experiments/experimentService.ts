import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  getActiveExperiment,
  takeNextVariantIndex,
} from "../../db/repositories/experimentRepository.js";
import { assignVariant } from "../../core/experiments/assignVariant.js";
import { getDimensionSpec } from "../../core/experiments/experiment.js";

/**
 * Сервис экспериментов (Шаг 13b) — оркестрация поверх ядра 13a и репозитория.
 *
 * Единственная задача на этом шаге: при постановке AI-поста в очередь назначить
 * ему вариант активного эксперимента (детерминированная ротация). Всё остальное
 * (экран/отчёт, вердикт, применение победителя) — следующие подшаги 13c–13e.
 */

/** Что нужно для назначения варианта: БД + логгер (ошибку глотаем, не роняем пост). */
export interface ExperimentDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
}

/**
 * Назначает следующий вариант активного эксперимента канала и возвращает его ключ
 * (для сохранения в `PendingPost.variantKey`). Нет активного эксперимента /
 * неизвестное измерение → `null` (пост публикуется вне эксперимента).
 *
 * Ротацию двигаем ТОЛЬКО когда реально есть куда назначить: `takeNextVariantIndex`
 * вызывается после проверки спецификации измерения. Любая ошибка (гонка, БД) →
 * лог + `null`: назначение варианта не должно ронять публикацию.
 */
export async function assignExperimentVariant(
  deps: ExperimentDeps,
  channelId: string,
): Promise<string | null> {
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
    return variant.key;
  } catch (err) {
    deps.logger.warn({ err, channelId }, "не смог назначить вариант эксперимента");
    return null;
  }
}
