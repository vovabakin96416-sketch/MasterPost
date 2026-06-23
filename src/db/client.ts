import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Создаёт Prisma-клиент поверх драйвер-адаптера @prisma/adapter-pg (Prisma 7).
 * Фабрика (а не глобальный синглтон) — ради явной передачи строки подключения
 * и тестируемости, в стиле createBot/createLogger.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export { PrismaClient };
