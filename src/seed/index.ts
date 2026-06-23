import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { createPrismaClient } from "../db/client.js";
import { upsertChannel } from "../db/repositories/channelRepository.js";
import { upsertPost } from "../db/repositories/postRepository.js";
import { upsertTextPool } from "../db/repositories/textPoolRepository.js";
import { parsePosts } from "../core/content/postSchema.js";
import { parseTextPools } from "../core/content/textPoolSchema.js";
import { taroChannel } from "./channel.js";

// Локально подхватываем .env (на хостинге переменные приходят из окружения).
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — это нормально в проде.
}

/** Читает и парсит JSON-файл данных рядом с этим модулем. */
function readJson(relativePath: string): unknown {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8"));
}

async function main(): Promise<void> {
  const env = parseEnv();
  const logger = createLogger(env.LOG_LEVEL);

  // Валидация на границе: кривые данные падают здесь, а не «протекают» в БД.
  const posts = parsePosts(readJson("./data/content.json"));
  const pools = parseTextPools(readJson("./data/texts.json"));

  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    const channelId = await upsertChannel(prisma, taroChannel);
    logger.info(
      { channelId, username: taroChannel.username },
      "канал №1 ок",
    );

    for (const post of posts) {
      await upsertPost(prisma, channelId, post);
    }
    for (const pool of pools) {
      await upsertTextPool(prisma, channelId, pool.key, pool.texts);
    }

    logger.info(
      { posts: posts.length, pools: pools.length },
      "сид завершён",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Данные сида не прошли валидацию:\n${issues}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
