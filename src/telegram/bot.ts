import { Bot } from "grammy";
import { createCommentsComposer } from "./features/comments/index.js";
import {
  buildMenuReplyKeyboard,
  createAdminComposer,
} from "./features/admin/index.js";
import { createApprovalComposer } from "./features/approval/index.js";
import { createPostButtonsComposer } from "./features/postButtons/index.js";
import { createOnboardingComposer } from "./features/onboarding/index.js";
import { findOwnerByTelegramId } from "../db/repositories/ownerRepository.js";
import type { CommentDeps } from "./features/comments/types.js";
import type { MtprotoConfig } from "../services/analytics/mtprotoConfig.js";

/** Зависимости бота: стадии-комментов + id админа для меню + ключ Pexels + ключ Anthropic + статус MTProto. */
export interface BotDeps extends CommentDeps {
  adminId: number;
  pexelsApiKey: string | undefined;
  anthropicApiKey: string | undefined; // Шаг 10b: AI-генерация постов (кнопка «🤖 AI-пост»)
  timeoutMs?: number | undefined; // Шаг 11b: таймаут вызова Claude (мс); undefined → дефолт
  telemetrApiKey: string | undefined; // Шаг 12e: рыночные данные (секция «🌍 Рынок»)
  mtproto: MtprotoConfig;
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
    // Зарегистрированному владельцу (гейт 14b-1 — таблица `Owner`, супервладелец
    // заведён на старте) сразу даём постоянную кнопку «📋 Меню» под полем ввода.
    const owner =
      ctx.from === undefined
        ? null
        : await findOwnerByTelegramId(deps.prisma, ctx.from.id);
    if (owner !== null) {
      await ctx.reply(
        "Привет! Я MasterPost — бот-управитель каналов.\nВнизу кнопка «📋 Меню» — нажми, чтобы открыть управление.",
        { reply_markup: buildMenuReplyKeyboard() },
      );
      return;
    }
    await ctx.reply(
      "Привет! Я MasterPost — бот-управитель каналов. Каркас работает ✅",
    );
  });

  // Шаг 3: меню админа (/menu) — управление триггерами/ответами/настройками.
  bot.use(createAdminComposer(deps));

  // Шаг 5: одобрение постов — кнопки превью (`ap:*`) и правка текста.
  // После меню: чужие callback'и/текст меню отдаёт дальше через next().
  bot.use(createApprovalComposer(deps));

  // Шаг 6b: кнопки на постах (`bp:*`) — выбор варианта / предсказание в личку.
  // Жмут любые подписчики; admin/approval-композеры пропускают чужие callback'и.
  bot.use(createPostButtonsComposer(deps));

  // Шаг 2: триггеры в комментах (карта/кофе/руна из конфига канала) + кулдаун.
  bot.use(createCommentsComposer(deps));

  // Шаг 9a: онбординг канала (`my_chat_member`) — авто-регистрация при добавлении бота
  // админом + уведомление владельца. Не пересекается с другими композерами по типу апдейта.
  bot.use(createOnboardingComposer(deps));

  return bot;
}
