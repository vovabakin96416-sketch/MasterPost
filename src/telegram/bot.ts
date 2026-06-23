import { Bot } from "grammy";

/**
 * Создаёт grammY-бота и регистрирует базовые хендлеры.
 * На Шаге 0 это только /start — фичи добавятся отдельными Composer'ами позже.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я MasterPost — бот-управитель каналов. Каркас работает ✅",
    );
  });

  return bot;
}
