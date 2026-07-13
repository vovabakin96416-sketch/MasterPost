import type { PrismaClient } from "../client.js";

/**
 * Доступ к экспериментам над контентом (таблица `Experiment`, Шаг 13b).
 *
 * Эксперимент проверяет ОДНО измерение канала (каталог 13a): его варианты
 * чередуются между AI-постами. Настоящего A/B в Telegram нет — ротация
 * последовательная, `assignedCount` держит счётчик уже назначенных вариантов
 * (детерминированная честная выборка, см. `core/experiments/assignVariant`).
 *
 * Инвариант «один активный эксперимент на канал» держит этот слой (не БД):
 * `startExperiment` останавливает предыдущий активный перед созданием нового.
 */

/** Строка эксперимента (то, что нужно слою вживления и отчёту). */
export interface ExperimentRow {
  readonly id: string;
  readonly channelId: string;
  readonly dimension: string; // ключ измерения из каталога 13a
  readonly status: "active" | "stopped";
  readonly assignedCount: number;
  readonly startedAt: Date;
  readonly stoppedAt: Date | null;
}

const SELECT = {
  id: true,
  channelId: true,
  dimension: true,
  status: true,
  assignedCount: true,
  startedAt: true,
  stoppedAt: true,
} as const;

/** Активный эксперимент канала или `null`, если ни одного не идёт. */
export async function getActiveExperiment(
  prisma: PrismaClient,
  channelId: string,
): Promise<ExperimentRow | null> {
  return prisma.experiment.findFirst({
    where: { channelId, status: "active" },
    select: SELECT,
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Запускает эксперимент по измерению (ключ из каталога 13a). Держит инвариант
 * «один активный на канал»: сначала останавливает текущий активный, затем
 * создаёт новый. Возвращает созданную строку.
 */
export async function startExperiment(
  prisma: PrismaClient,
  channelId: string,
  dimension: string,
): Promise<ExperimentRow> {
  await stopActiveExperiment(prisma, channelId);
  return prisma.experiment.create({
    data: { channelId, dimension },
    select: SELECT,
  });
}

/**
 * Останавливает активный эксперимент канала (status → stopped, ставит `stoppedAt`).
 * Идемпотентно: если активного нет, ничего не делает. Возвращает число остановленных.
 */
export async function stopActiveExperiment(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  const result = await prisma.experiment.updateMany({
    where: { channelId, status: "active" },
    data: { status: "stopped", stoppedAt: new Date() },
  });
  return result.count;
}

/**
 * Атомарно резервирует следующий индекс ротации: увеличивает `assignedCount` на 1
 * и возвращает индекс ДО инкремента (его и передаём в `assignVariant`). Инкремент
 * в БД (`increment`) исключает гонку двух параллельных постановок в очередь.
 */
export async function takeNextVariantIndex(
  prisma: PrismaClient,
  experimentId: string,
): Promise<number> {
  const updated = await prisma.experiment.update({
    where: { id: experimentId },
    data: { assignedCount: { increment: 1 } },
    select: { assignedCount: true },
  });
  return updated.assignedCount - 1;
}
