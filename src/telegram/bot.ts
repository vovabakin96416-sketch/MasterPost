import { Bot } from "grammy";
import { createCommentsComposer } from "./features/comments/index.js";
import { createAdminComposer } from "./features/admin/index.js";
import { createApprovalComposer } from "./features/approval/index.js";
import type { CommentDeps } from "./features/comments/types.js";

/** Зависимости бота: стадии-комментов + id админа для меню + ключ Pexels (фото). */
export interface BotDeps extends CommentDeps {
  adminId: number;
  pexelsApiKey: string | undefined;
}

/**
 * Создаёт grammY-бота и регистрирует хендлеры. Каждая фича — отдельный Composer,
 * поэтому модули изолированы: правка одного не ломает остальные.
 *
 * `deps` (prisma/logger/adminId) прокидываются явно — в стиле createLogger/
 * createPrismaClient, ради тестируемости и отсутствия глобальных синглтонов.
 */
export function createBot(token: string, deps: BotDeps): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я MasterPost — бот-управитель каналов. Каркас работает ✅",
    );
  });

  // Шаг 3: меню админа (/menu) — управление триггерами/ответами/настройками.
  bot.use(createAdminComposer(deps));

  // Шаг 5: одобрение постов — кнопки превью (`ap:*`) и правка текста.
  // После меню: чужие callback'и/текст меню отдаёт дальше через next().
  bot.use(createApprovalComposer(deps));

  // Шаг 2: триггеры в комментах (карта/кофе/руна из конфига канала) + кулдаун.
  bot.use(createCommentsComposer(deps));

  return bot;
}
