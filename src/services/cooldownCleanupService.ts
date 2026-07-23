import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import { cooldownPurgeCutoff } from "../core/triggers/cooldown.js";
import { deleteExpiredCooldowns } from "../db/repositories/cooldownRepository.js";

/**
 * Чистка таблицы `Cooldown` (аудит 2026-07: строки копились без удаления).
 * Вызывается суточным кроном (`scheduler/analytics.ts`). Граница удаления —
 * в чистом core (`cooldownPurgeCutoff`: истёкшие дольше 30 дней назад) —
 * «колода» анти-повтора недавних пользователей не сбрасывается.
 */

export interface CooldownCleanupDeps {
  prisma: PrismaClient;
  logger: Logger;
}

/** Удаляет давно истёкшие кулдауны; сбой не фатален (крон ловит и логирует). */
export async function runCooldownCleanup(deps: CooldownCleanupDeps): Promise<void> {
  const cutoff = cooldownPurgeCutoff(new Date());
  const removed = await deleteExpiredCooldowns(deps.prisma, cutoff);
  if (removed > 0) {
    deps.logger.info({ removed }, "чистка кулдаунов: удалены давно истёкшие строки");
  }
}
