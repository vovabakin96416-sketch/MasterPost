import type { PrismaClient } from "../client.js";

/**
 * Состояние кулдауна на пару (канал, пользователь, слово): когда истекает и
 * «память» недавно показанных ответов (ключи) для анти-повтора («колода»).
 */
export interface CooldownState {
  expiresAt: Date;
  recent: string[];
}

/**
 * Читает строку кулдауна по уникуму `channelId_userId_trigger` или `null`.
 * Решение «на кулдауне ли» и выбор без повтора — в чистом core; здесь только I/O.
 */
export async function loadCooldown(
  prisma: PrismaClient,
  channelId: string,
  userId: string,
  trigger: string,
): Promise<CooldownState | null> {
  const row = await prisma.cooldown.findUnique({
    where: { channelId_userId_trigger: { channelId, userId, trigger } },
    select: { expiresAt: true, recent: true },
  });
  return row ? { expiresAt: row.expiresAt, recent: row.recent } : null;
}

/**
 * Идемпотентно сохраняет кулдаун (срок + память) по уникуму. Вызывается, только
 * когда бот реально ответил (как в Python — кулдаун ставится при ответе).
 */
export async function saveCooldown(
  prisma: PrismaClient,
  channelId: string,
  userId: string,
  trigger: string,
  expiresAt: Date,
  recent: string[],
): Promise<void> {
  await prisma.cooldown.upsert({
    where: { channelId_userId_trigger: { channelId, userId, trigger } },
    create: { channelId, userId, trigger, expiresAt, recent },
    update: { expiresAt, recent },
  });
}

/**
 * Удаляет строки кулдауна, истёкшие раньше `cutoff` (граница — в чистом core:
 * `cooldownPurgeCutoff`). Возвращает число удалённых. Вызывается суточным кроном.
 */
export async function deleteExpiredCooldowns(
  prisma: PrismaClient,
  cutoff: Date,
): Promise<number> {
  const result = await prisma.cooldown.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
