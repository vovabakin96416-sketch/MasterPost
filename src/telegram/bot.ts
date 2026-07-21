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
import { isClientBotUpdateAllowed } from "../core/bots/botStartup.js";
import {
  ACCESS_DENIED_TRIAL_EXPIRED,
  checkOwnerRecordAccess,
} from "../core/menu/ownerPlan.js";
import type { CommentDeps } from "./features/comments/types.js";
import type { MtprotoConfig } from "../services/analytics/mtprotoConfig.js";
import type { OwnerBotRegistry } from "../services/botRegistry.js";

/** Зависимости бота: стадии-комментов + id админа для меню + ключ Pexels + ключ Anthropic + статус MTProto. */
export interface BotDeps extends CommentDeps {
  adminId: number;
  pexelsApiKey: string | undefined;
  anthropicApiKey: string | undefined; // Шаг 10b: AI-генерация постов (кнопка «🤖 AI-пост»)
  timeoutMs?: number | undefined; // Шаг 11b: таймаут вызова Claude (мс); undefined → дефолт
  telemetrApiKey: string | undefined; // Шаг 12e: рыночные данные (секция «🌍 Рынок»)
  // Шаг 14b-bis-1: ключ шифрования bot-токенов клиентов + id общего бота (его
  // подключать себе нельзя). Без ключа экран «🤖 Мой бот» отключён.
  botTokenEncKey: string | undefined;
  mainBotUserId: string | undefined;
  // Шаг 14b-bis-2: если бот поднят как БОТ КЛИЕНТА — Telegram-id его владельца.
  // undefined → это общий бот (обслуживает всех зарегистрированных владельцев).
  clientOwnerUserId?: number | undefined;
  // Шаг 14b-bis-2: реестр ботов клиентов (меню поднимает/гасит бота по кнопке).
  ownerBots?: OwnerBotRegistry | undefined;
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

  // 🔒 Шаг 14b-bis-2. Бот клиента в ЛИЧКЕ обслуживает только своего владельца.
  // Причина не в вежливости: токен этого бота у клиента, значит все его апдейты
  // клиент вправе прочитать. Пустив сюда чужую личку, мы показали бы чужое меню
  // (каналы, план, отчёты) через бота постороннего человека.
  // Не-личные апдейты (пост в канале, коммент, кнопка под постом, назначение
  // админом) идут дальше как обычно — их шлют подписчики, а не владелец.
  const { clientOwnerUserId } = deps;
  if (clientOwnerUserId !== undefined) {
    bot.use(async (ctx, next) => {
      if (
        !isClientBotUpdateAllowed(ctx.chat?.type, ctx.from?.id, clientOwnerUserId)
      ) {
        // Молча: отвечать постороннему — значит превратить бота клиента в
        // рассылочный автомат для того, кто нашёл его @username.
        return;
      }
      await next();
    });
  }

  bot.command("start", async (ctx) => {
    // Зарегистрированному владельцу (гейт 14b-1 — таблица `Owner`, супервладелец
    // заведён на старте) сразу даём постоянную кнопку «📋 Меню» под полем ввода.
    // С 14e кнопку получает только тот, у кого доступ ещё действует: кнопка,
    // которая не открывает меню, хуже её отсутствия.
    const owner =
      ctx.from === undefined
        ? null
        : await findOwnerByTelegramId(deps.prisma, ctx.from.id);
    if (
      owner !== null &&
      !checkOwnerRecordAccess(owner, deps.adminId, new Date()).ok
    ) {
      await ctx.reply(ACCESS_DENIED_TRIAL_EXPIRED);
      return;
    }
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
