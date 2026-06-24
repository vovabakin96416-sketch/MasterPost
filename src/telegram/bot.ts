import { Bot } from "grammy";
import { createCommentsComposer } from "./features/comments/index.js";
import type { CommentDeps } from "./features/comments/types.js";

/**
 * Создаёт grammY-бота и регистрирует хендлеры. Каждая фича — отдельный Composer,
 * поэтому модули изолированы: правка одного не ломает остальные.
 *
 * `deps` (prisma/logger) прокидываются явно — в стиле createLogger/createPrismaClient,
 * ради тестируемости и отсутствия глобальных синглтонов.
 */
export function createBot(token: string, deps: CommentDeps): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я MasterPost — бот-управитель каналов. Каркас работает ✅",
    );
  });

  // Шаг 2: триггеры в комментах (карта/кофе/руна из конфига канала) + кулдаун.
  bot.use(createCommentsComposer(deps));

  return bot;
}
