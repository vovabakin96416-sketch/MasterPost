import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../client.js";
import type { TopHour } from "../../core/analytics/topHours.js";

/**
 * Доступ к периодическим снимкам агрегатов канала (таблица `ChannelStatSnapshot`,
 * Шаг 12b). Джоб аналитики раз в сутки кладёт сюда «подписчики / посты за 7д / средние
 * просмотры и ERR за 7д»; Content Intelligence сравнивает снимки во времени (тренд охвата)
 * без пересчёта по всем сырым метрикам. Только запись последнего снимка и чтение истории.
 */

/** Поля снимка, которые считает джоб (id/канал/дата проставляет БД). */
export interface StatSnapshotInput {
  readonly subscribers: number | null;
  readonly postCount7d: number;
  readonly avgViews7d: number;
  readonly avgErr7d: number;
  readonly topHours: readonly TopHour[]; // нативные лучшие часы (12b-2), пусто = нет статы
}

/** Снимок как читается из БД (для тренда охвата). */
export interface StatSnapshotRow extends StatSnapshotInput {
  readonly capturedAt: Date;
}

/** Сохраняет новый снимок агрегатов канала (append-only — историю не перезатираем). */
export async function createStatSnapshot(
  prisma: PrismaClient,
  channelId: string,
  data: StatSnapshotInput,
): Promise<void> {
  await prisma.channelStatSnapshot.create({
    data: {
      channelId,
      subscribers: data.subscribers,
      postCount7d: data.postCount7d,
      avgViews7d: data.avgViews7d,
      avgErr7d: data.avgErr7d,
      // Пишем всегда массив (в т.ч. пустой) — так обходим Prisma DbNull/JsonNull у Json?.
      // `as unknown as InputJsonValue`: TopHour[] сериализуем в JSON, но интерфейс без
      // индекс-сигнатуры Prisma к InputJsonObject напрямую не пускает.
      topHours: [...data.topHours] as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Самый свежий снимок канала (или `null`, если снимков ещё нет). */
export async function getLatestStatSnapshot(
  prisma: PrismaClient,
  channelId: string,
): Promise<StatSnapshotRow | null> {
  const row = await prisma.channelStatSnapshot.findFirst({
    where: { channelId },
    orderBy: { capturedAt: "desc" },
    select: {
      capturedAt: true,
      subscribers: true,
      postCount7d: true,
      avgViews7d: true,
      avgErr7d: true,
      topHours: true,
    },
  });
  if (row === null) {
    return null;
  }
  const { topHours, ...rest } = row;
  return { ...rest, topHours: toTopHours(topHours) };
}

/**
 * Мягко приводит Json-колонку `topHours` к `TopHour[]`: массив объектов с числовыми
 * `hour`/`value`. Старые (до 12b-2) или битые значения → пустой список.
 */
function toTopHours(value: unknown): TopHour[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: TopHour[] = [];
  for (const item of value) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { hour?: unknown }).hour === "number" &&
      typeof (item as { value?: unknown }).value === "number"
    ) {
      const { hour, value: v } = item as { hour: number; value: number };
      result.push({ hour, value: v });
    }
  }
  return result;
}
