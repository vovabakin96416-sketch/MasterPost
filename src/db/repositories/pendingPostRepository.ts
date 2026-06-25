import type { PrismaClient } from "../client.js";

/**
 * Доступ к очереди постов на одобрении (таблица `PendingPost`, Шаг 5).
 * Снимок текста создаёт планировщик/меню; читает и удаляет — композер `approval`.
 * Хранение в БД (а не in-memory, как `pending_posts` в Python) переживает рестарт
 * на хостинге: пост, отправленный на одобрение, не теряется при редеплое.
 */

/** Строка очереди одобрения (то, что нужно для превью и публикации). */
export interface PendingPostRow {
  readonly id: string;
  readonly channelId: string;
  readonly externalId: number | null;
  readonly title: string;
  readonly text: string;
  readonly cta: string;
}

const SELECT = {
  id: true,
  channelId: true,
  externalId: true,
  title: true,
  text: true,
  cta: true,
} as const;

/** Поля снимка поста при постановке в очередь. */
export interface PendingPostInput {
  readonly title: string;
  readonly text: string;
  readonly cta: string;
  readonly externalId: number | null;
}

/** Кладёт пост в очередь одобрения, возвращает созданную строку (с её id). */
export async function createPending(
  prisma: PrismaClient,
  channelId: string,
  data: PendingPostInput,
): Promise<PendingPostRow> {
  return prisma.pendingPost.create({
    data: { channelId, ...data },
    select: SELECT,
  });
}

/** Возвращает строку очереди по id (или `null`, если уже обработана/не найдена). */
export async function getPending(
  prisma: PrismaClient,
  id: string,
): Promise<PendingPostRow | null> {
  return prisma.pendingPost.findUnique({ where: { id }, select: SELECT });
}

/**
 * Обновляет текст поста в очереди (правка на одобрении). Возвращает обновлённую
 * строку или `null`, если она уже удалена (обработана параллельно).
 */
export async function updatePendingText(
  prisma: PrismaClient,
  id: string,
  text: string,
): Promise<PendingPostRow | null> {
  const existing = await getPending(prisma, id);
  if (existing === null) {
    return null;
  }
  return prisma.pendingPost.update({ where: { id }, data: { text }, select: SELECT });
}

/** Убирает пост из очереди (опубликован / пропущен / отменён). Идемпотентно. */
export async function deletePending(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.pendingPost.deleteMany({ where: { id } });
}

/** Сколько постов ждут одобрения (для экрана меню). */
export async function countPending(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  return prisma.pendingPost.count({ where: { channelId } });
}
