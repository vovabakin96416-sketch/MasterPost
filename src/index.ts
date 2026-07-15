import { ZodError } from "zod";
import { autoRetry } from "@grammyjs/auto-retry";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { createPrismaClient } from "./db/client.js";
import {
  claimOrphanChannels,
  ensureOwner,
} from "./db/repositories/ownerRepository.js";
import { createBot } from "./telegram/bot.js";
import { startScheduler } from "./scheduler/index.js";
import { startAnalyticsScheduler } from "./scheduler/analytics.js";
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

  // Шаг 14a: фундамент мультитенанта. Идемпотентно заводим супервладельца (= ADMIN_ID)
  // и отдаём ему каналы без владельца (бэкофилл существующих + каналы, созданные через
  // «➕ Добавить канал», — их штамповка появится в 14b). Поведение бота НЕ меняется:
  // по `ownerId` пока ничего не фильтруется. Сбой не фатален — на 14a от владельца
  // ничего не зависит, поэтому пишем в лог и работаем дальше.
  try {
    const superOwnerId = await ensureOwner(prisma, env.ADMIN_ID);
    const claimed = await claimOrphanChannels(prisma, superOwnerId);
    logger.info(
      { superOwnerId, claimed },
      "супервладелец готов; каналы без владельца присвоены",
    );
  } catch (err) {
    logger.error({ err }, "не смог завести супервладельца / присвоить каналы");
  }

  // Шаг 7b: чистый конфиг MTProto (без GramJS) — только для статуса в меню «Аналитика».
  const mtproto = {
    apiId: env.TELEGRAM_API_ID,
    apiHash: env.TELEGRAM_API_HASH,
    session: env.TELEGRAM_SESSION,
  };
  const bot = createBot(env.BOT_TOKEN, {
    prisma,
    logger,
    adminId: env.ADMIN_ID,
    pexelsApiKey: env.PEXELS_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
    telemetrApiKey: env.TELEMETR_API_KEY,
    mtproto,
  });

  // Авто-повтор при лимитах Telegram (429 retry_after) и транзиентных сетевых
  // сбоях: без него пост/превью просто теряется с ошибкой в логе.
  bot.api.config.use(autoRetry());

  // Шаг 4: планировщик автопостинга (тик раз в минуту через bot.api).
  const scheduler = startScheduler({
    prisma,
    logger,
    api: bot.api,
    adminId: env.ADMIN_ID,
    pexelsApiKey: env.PEXELS_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
  });

  // Шаг 7a/7c: планировщик аналитики (напоминание ВС 21:00 МСК + отчёт по просмотрам
  // ПН 09:30 МСК). `mtproto` пробрасываем для отчёта; без него отчёт тихо отключён.
  const analyticsScheduler = startAnalyticsScheduler({
    prisma,
    logger,
    api: bot.api,
    adminId: env.ADMIN_ID,
    mtproto,
    // Шаг 12d: AI-пересказ секции роста в отчёте (тумблер в меню; без ключа — эвристика).
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
    // Шаг 12e-2: секция «🌍 Рынок» в отчёте (без ключа секции просто нет).
    telemetrApiKey: env.TELEMETR_API_KEY,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    scheduler.stop();
    analyticsScheduler.stop();
    void bot.stop();
    server.close();
    void prisma.$disconnect();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // Глобальный обработчик ошибок хендлеров: один сбой (упала БД на нажатии кнопки
  // и т.п.) не должен ронять long polling и весь процесс.
  bot.catch((err) => {
    logger.error(
      { err: err.error, update: err.ctx.update.update_id },
      "ошибка обработки апдейта",
    );
  });
  // Страховка процесса: необработанный reject из фоновых задач — в лог, не в смерть.
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "unhandled rejection");
  });

  // Синяя кнопка «Menu» у поля ввода: вход в /menu не теряется, даже если
  // reply-клавиатура «📋 Меню» пропала (она ставится только на /start).
  try {
    await bot.api.setMyCommands([
      { command: "menu", description: "Меню управления" },
      { command: "start", description: "Перезапуск + кнопка меню" },
    ]);
  } catch (err) {
    logger.error({ err }, "не смог установить список команд бота");
  }

  logger.info("starting bot (long polling)");
  await bot.start({
    onStart: (info) => logger.info({ username: info.username }, "bot started"),
  });
}

// Фатальный сбой (упал long polling, напр. 409 «другой getUpdates») — выходим с
// ошибкой, чтобы хостинг перезапустил процесс. Иначе процесс живёт «зомби»:
// health-сервер держит его, а апдейты бот уже не читает.
main().catch((err: unknown) => {
  console.error("фатальная ошибка запуска бота:", err);
  process.exit(1);
});
