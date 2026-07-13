import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  getActiveExperiment,
  takeNextVariantIndex,
} from "../../db/repositories/experimentRepository.js";
import { assignVariant } from "../../core/experiments/assignVariant.js";
import { getDimensionSpec } from "../../core/experiments/experiment.js";

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
