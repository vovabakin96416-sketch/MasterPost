/**
 * tryGeneratePost.ts — dev-харнес ручной проверки AI-генерации (Шаг 10a).
 *
 * `npm run try-ai` — по первому активному каналу берёт несколько его постов как
 * образцы стиля, просит Claude сгенерировать свежий черновик и печатает JSON
 * `{ title, text, cta, pexelsQuery }`. Нужны в `.env`: ANTHROPIC_API_KEY (иначе
 * генерация отключена) и DATABASE_URL с засеянным каналом (`npm run seed`).
 *
 * Ничего не публикует и не пишет в БД — только читает и печатает. На сервере не нужен.
 */
import { createLogger } from "../src/lib/logger.js";
import { createPrismaClient } from "../src/db/client.js";
import { getPostingChannel } from "../src/db/repositories/channelRepository.js";
import { getSamplePosts } from "../src/db/repositories/postRepository.js";
import { generatePostDraft } from "../src/services/ai/aiGenerationService.js";

// Подхватываем .env (как в index.ts / generateSession.ts).
try {
  process.loadEnvFile();
} catch {
  // .env может отсутствовать — тогда переменные проверим ниже.
}

/** Значение env или undefined, если пусто/не задано. */
function envOrUndefined(key: string): string | undefined {
  const value = process.env[key];
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const apiKey = envOrUndefined("ANTHROPIC_API_KEY");
  if (apiKey === undefined) {
    console.error("Нет ANTHROPIC_API_KEY в .env — добавь ключ Anthropic и повтори.");
    process.exitCode = 1;
    return;
  }
  const databaseUrl = envOrUndefined("DATABASE_URL");
  if (databaseUrl === undefined) {
    console.error("Нет DATABASE_URL в .env.");
    process.exitCode = 1;
    return;
  }

  const logger = createLogger("info");
  const prisma = createPrismaClient(databaseUrl);
  try {
    const channel = await getPostingChannel(prisma);
    if (channel === null) {
      console.error("Нет активного канала — запусти сид: npm run seed.");
      process.exitCode = 1;
      return;
    }
    const examples = await getSamplePosts(prisma, channel.id, 6);
    if (examples.length === 0) {
      console.error("У канала нет постов-образцов — запусти сид: npm run seed.");
      process.exitCode = 1;
      return;
    }

    console.log(
      `Канал: ${channel.title} · образцов стиля: ${String(examples.length)}\nГенерирую…\n`,
    );
    const draft = await generatePostDraft(
      { logger, apiKey },
      { channelTitle: channel.title, examples },
    );
    if (draft === null) {
      console.error("Не удалось сгенерировать черновик (подробности в логе выше).");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(draft, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
