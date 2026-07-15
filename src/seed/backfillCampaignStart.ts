import { ZodError } from "zod";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { createPrismaClient } from "../db/client.js";
import {
  ensureCampaignStart,
  listChannels,
} from "../db/repositories/channelRepository.js";
import { getFirstPublishedAt } from "../db/repositories/postRepository.js";

/**
 * Разовый скрипт: чинит каналы, у которых `campaignStart` пустой, хотя план уже
 * работал. Запуск — `npm run backfill-campaign-start`.
 *
 * Зачем: пока старт лежал в сиде со значением `null`, каждый `npm run seed` затирал
 * его через `update: data` — и `resolveCampaignDay` навсегда отдавал «неделю 1».
 * Сид починен (старт туда больше не входит), но уже затёртые каналы надо восстановить.
 *
 * Восстанавливаем ЧЕСТНО, по дате первой публикации канала. Если канал не публиковал
 * ничего, старт не выдумываем: план и правда ещё не начинался — его зафиксирует
 * `ensureCampaignStart` при включении автопостинга.
 *
 * Идемпотентно: `ensureCampaignStart` не перезаписывает уже заданный старт, так что
 * повторный прогон ничего не сломает.
 */

// Локально подхватываем .env (на хостинге переменные приходят из окружения).
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — это нормально в проде.
}

async function main(): Promise<void> {
  const env = parseEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    const channels = await listChannels(prisma);
    for (const channel of channels) {
      const firstPost = await getFirstPublishedAt(prisma, channel.id);
      if (firstPost === null) {
        logger.info(
          { channelId: channel.id, title: channel.title },
          "план ещё не начинался (нет опубликованных постов) — старт не выдумываем",
        );
        continue;
      }
      const start = await ensureCampaignStart(prisma, channel.id, firstPost);
      logger.info(
        { channelId: channel.id, title: channel.title, campaignStart: start },
        start?.getTime() === firstPost.getTime()
          ? "старт плана восстановлен по дате первой публикации"
          : "старт плана уже был задан — не трогаем",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Переменные окружения не прошли валидацию:\n${issues}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
