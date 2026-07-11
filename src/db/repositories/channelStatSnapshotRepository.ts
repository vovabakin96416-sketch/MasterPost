import type { PrismaClient } from "../client.js";

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
    },
  });
}

/** Самый свежий снимок канала (или `null`, если снимков ещё нет). */
export async function getLatestStatSnapshot(
  prisma: PrismaClient,
  channelId: string,
): Promise<StatSnapshotRow | null> {
  return prisma.channelStatSnapshot.findFirst({
    where: { channelId },
    orderBy: { capturedAt: "desc" },
    select: {
      capturedAt: true,
      subscribers: true,
      postCount7d: true,
      avgViews7d: true,
      avgErr7d: true,
    },
  });
}
