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
