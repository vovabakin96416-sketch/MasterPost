import { ZodError } from "zod";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { createPrismaClient } from "./db/client.js";
import { createBot } from "./telegram/bot.js";
import { startHealthServer } from "./server/health.js";

// Локально подхватываем .env (на хостинге переменные приходят из платформы,
// файла нет — поэтому ошибку «нет файла» молча игнорируем).
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — это нормально в проде.
}

function loadEnv() {
  try {
    return parseEnv();
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
        .join("\n");
      console.error(`Ошибка конфигурации окружения:\n${issues}`);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const server = startHealthServer(env.PORT, logger);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const bot = createBot(env.BOT_TOKEN, { prisma, logger, adminId: env.ADMIN_ID });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    void bot.stop();
    server.close();
    void prisma.$disconnect();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("starting bot (long polling)");
  await bot.start({
    onStart: (info) => logger.info({ username: info.username }, "bot started"),
  });
}

void main();
