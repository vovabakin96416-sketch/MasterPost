import type { PrismaClient } from "../client.js";
import { isOnCooldown, nextExpiry } from "../../core/triggers/cooldown.js";

/**
 * Проверяет и «потребляет» кулдаун на пару (канал, пользователь, слово).
 *
 * - Если запись есть и ещё не истекла → `false` (на кулдауне, ответ не даём).
 * - Иначе ставит/обновляет срок `now + ttlHours` и возвращает `true` (можно
 *   отвечать). Идемпотентный upsert по уникуму `channelId_userId_trigger`.
 *
 * Time-логика вынесена в чистый `core/triggers/cooldown` и покрыта тестами.
 */
export async function tryConsumeCooldown(
  prisma: PrismaClient,
  channelId: string,
  userId: string,
  trigger: string,
  ttlHours: number,
  now: Date = new Date(),
): Promise<boolean> {
  const key = { channelId_userId_trigger: { channelId, userId, trigger } };

  const existing = await prisma.cooldown.findUnique({
    where: key,
    select: { expiresAt: true },
  });
  if (existing && isOnCooldown(existing.expiresAt, now)) {
    return false;
  }

  const expiresAt = nextExpiry(now, ttlHours);
  await prisma.cooldown.upsert({
    where: key,
    create: { channelId, userId, trigger, expiresAt },
    update: { expiresAt },
  });
  return true;
}
