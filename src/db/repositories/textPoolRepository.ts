import type { PrismaClient } from "../client.js";

/**
 * Идемпотентно создаёт/обновляет пул текстов канала по паре (channelId, key).
 */
export async function upsertTextPool(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  texts: string[],
): Promise<void> {
  await prisma.textPool.upsert({
    where: { channelId_key: { channelId, key } },
    create: { channelId, key, texts },
    update: { texts },
  });
}

/**
 * Возвращает тексты пула по паре (channelId, key) или `null`, если пула нет.
 * Используется триггерами (Шаг 2): ключ пула = совпавшее слово-триггер.
 */
export async function getTextPool(
  prisma: PrismaClient,
  channelId: string,
  key: string,
): Promise<string[] | null> {
  const pool = await prisma.textPool.findUnique({
    where: { channelId_key: { channelId, key } },
    select: { texts: true },
  });
  return pool ? pool.texts : null;
}
