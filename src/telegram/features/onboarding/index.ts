import { Composer, type Context, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import {
  classifyBotMembership,
  evaluateChannelRights,
  extractRights,
} from "../../../core/onboarding/membership.js";
import {
  getOwnerTelegramIdByChatId,
  registerChannelFromOnboarding,
} from "../../../db/repositories/channelRepository.js";
import { findOwnerByTelegramId } from "../../../db/repositories/ownerRepository.js";

/** Зависимости онбординга: БД (гейт владельцев + регистрация канала) и лог. */
export interface OnboardingDeps {
  prisma: PrismaClient;
  logger: Logger;
}

/**
 * Композер онбординга канала (Шаг 9a). Изолированный модуль: ловит `my_chat_member` —
 * событие про членство самого бота (grammY шлёт его только про бота, сравнивать id не нужно).
 *
 * «Подключи канал → работает»: владелец добавляет бота админом в канал → бот авто-регистрирует
 * канал (chatId/username/title), проверяет право публиковать и пишет владельцу. Реагируем
 * только на каналы; группы/супергруппы — это обсуждения (их ведёт композер комментов).
 *
 * Мультитенант (Шаг 14b-1): подключать канал может ЛЮБОЙ зарегистрированный владелец
 * (строка в `Owner`), а не только супервладелец; канал штампуется его `ownerId` и попадает
 * в его скоуп меню. DM о подключении идёт подключившему; о разжаловании/удалении бота —
 * владельцу КАНАЛА (по `Channel.ownerId`). Незарегистрированные пользователи игнорируются.
 */
export function createOnboardingComposer(deps: OnboardingDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("my_chat_member", async (ctx) => {
    const upd = ctx.myChatMember;
    const chat = upd.chat;
    if (chat.type !== "channel") {
      return;
    }

    const change = classifyBotMembership(
      upd.old_chat_member.status,
      upd.new_chat_member.status,
    );
    const title = chat.title;
    const chatId = String(chat.id);

    if (change === "promoted") {
      // Бот публичный: добавить его админом может кто угодно. Регистрируем канал
      // только для зарегистрированного владельца — чужие каналы в реестр не попадают.
      const owner = await findOwnerByTelegramId(deps.prisma, upd.from.id);
      if (owner === null) {
        deps.logger.warn(
          { chatId: chat.id, title, byUserId: upd.from.id },
          "онбординг: бота добавил незарегистрированный пользователь — игнорирую",
        );
        return;
      }

      const username = chat.username ?? null;
      const member = upd.new_chat_member;
      const canPostRaw =
        member.status === "administrator" ? member.can_post_messages : undefined;
      const rights = evaluateChannelRights(
        extractRights(member.status, canPostRaw),
      );

      const result = await registerChannelFromOnboarding(deps.prisma, {
        chatId,
        username,
        title,
        ownerId: owner.id,
      });
      deps.logger.info(
        {
          chatId,
          username,
          channelId: result.id,
          created: result.created,
          ownerId: owner.id,
          canPost: rights.canPost,
        },
        "онбординг: канал подключён",
      );

      const lead = result.created
        ? `✅ Канал «${title}» подключён.`
        : `✅ Канал «${title}» обновлён и привязан к боту.`;
      const tail = rights.canPost
        ? "Можно включать автопостинг в «📡 Каналы»."
        : "Чтобы публиковать посты, дай боту право «Публикация сообщений» в настройках администратора канала.";
      await notifyUser(ctx, deps, upd.from.id, `${lead}\n${rights.summary}\n\n${tail}`);
      return;
    }

    if (change === "demoted" || change === "removed") {
      // Разжаловать/убрать бота может любой админ канала — уведомляем владельца
      // КАНАЛА из реестра. Канал не зарегистрирован или без владельца → некому писать.
      const ownerTelegramId = await getOwnerTelegramIdByChatId(deps.prisma, chatId);
      if (ownerTelegramId === null) {
        deps.logger.warn(
          { chatId: chat.id, title, change },
          "онбординг: смена прав в канале без владельца в реестре — некого уведомить",
        );
        return;
      }
      const text =
        change === "demoted"
          ? `⚠️ Бота лишили прав администратора в канале «${title}». Автопостинг и проверка прав не сработают, пока права не вернёшь.`
          : `⚠️ Бота убрали из канала «${title}». В реестре канал остаётся — выключи его в «📡 Каналы», если он больше не нужен.`;
      await notifyUser(ctx, deps, Number(ownerTelegramId), text);
    }
  });

  return composer;
}

/** Шлёт DM пользователю; глушит GrammyError (человек не нажал /start у бота). */
async function notifyUser(
  ctx: Context,
  deps: OnboardingDeps,
  telegramUserId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.sendMessage(telegramUserId, text);
  } catch (err) {
    if (err instanceof GrammyError) {
      deps.logger.warn(
        { telegramUserId, err: err.description },
        "онбординг: не смог уведомить владельца (нажми /start у бота)",
      );
      return;
    }
    throw err;
  }
}
