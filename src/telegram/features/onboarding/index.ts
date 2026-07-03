import { Composer, type Context, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import {
  classifyBotMembership,
  evaluateChannelRights,
  extractRights,
} from "../../../core/onboarding/membership.js";
import { registerChannelFromOnboarding } from "../../../db/repositories/channelRepository.js";

/** Зависимости онбординга: БД (регистрация канала), лог, id владельца (кому слать DM). */
export interface OnboardingDeps {
  prisma: PrismaClient;
  logger: Logger;
  adminId: number;
}

/**
 * Композер онбординга канала (Шаг 9a). Изолированный модуль: ловит `my_chat_member` —
 * событие про членство самого бота (grammY шлёт его только про бота, сравнивать id не нужно).
 *
 * «Подключи канал → работает»: владелец добавляет бота админом в канал → бот авто-регистрирует
 * канал (chatId/username/title), проверяет право публиковать и пишет владельцу. Реагируем
 * только на каналы; группы/супергруппы — это обсуждения (их ведёт композер комментов).
 */
export function createOnboardingComposer(deps: OnboardingDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("my_chat_member", async (ctx) => {
    const upd = ctx.myChatMember;
    const chat = upd.chat;
    if (chat.type !== "channel") {
      return;
    }
    // Бот публичный: добавить его админом в канал может кто угодно. Регистрируем
    // канал (и шлём DM) только когда права менял сам владелец — чужие каналы не
    // должны попадать в реестр и путать меню.
    if (upd.from.id !== deps.adminId) {
      deps.logger.warn(
        { chatId: chat.id, title: chat.title, byUserId: upd.from.id },
        "онбординг: изменение членства не от владельца — игнорирую",
      );
      return;
    }

    const change = classifyBotMembership(
      upd.old_chat_member.status,
      upd.new_chat_member.status,
    );
    const title = chat.title;

    if (change === "promoted") {
      const chatId = String(chat.id);
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
      });
      deps.logger.info(
        {
          chatId,
          username,
          channelId: result.id,
          created: result.created,
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
      await notifyOwner(ctx, deps, `${lead}\n${rights.summary}\n\n${tail}`);
      return;
    }

    if (change === "demoted") {
      await notifyOwner(
        ctx,
        deps,
        `⚠️ Бота лишили прав администратора в канале «${title}». Автопостинг и проверка прав не сработают, пока права не вернёшь.`,
      );
      return;
    }

    if (change === "removed") {
      await notifyOwner(
        ctx,
        deps,
        `⚠️ Бота убрали из канала «${title}». В реестре канал остаётся — выключи его в «📡 Каналы», если он больше не нужен.`,
      );
    }
  });

  return composer;
}

/** Шлёт DM владельцу; глушит GrammyError (владелец не нажал /start у бота). */
async function notifyOwner(
  ctx: Context,
  deps: OnboardingDeps,
  text: string,
): Promise<void> {
  try {
    await ctx.api.sendMessage(deps.adminId, text);
  } catch (err) {
    if (err instanceof GrammyError) {
      deps.logger.warn(
        { err: err.description },
        "онбординг: не смог уведомить владельца (нажми /start у бота)",
      );
      return;
    }
    throw err;
  }
}
