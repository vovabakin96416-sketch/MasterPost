import type { Api, Bot } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import { decryptSecret } from "../core/security/tokenCipher.js";
import {
  BOT_ERROR_DECRYPT,
  describeBotStartError,
  parseBotOwnerUserId,
} from "../core/bots/botStartup.js";
import {
  clearBotAccountError,
  listActiveBotAccounts,
  markBotAccountError,
} from "../db/repositories/botAccountRepository.js";

/**
 * Реестр ботов клиентов (Шаг 14b-bis-2) — «мультибот в одном процессе».
 *
 * До этого шага процесс поднимал ровно одного бота из `BOT_TOKEN`. Теперь рядом
 * с ним живут боты владельцев: по одному long polling на каждый подключённый
 * `BotAccount`, все в этом же процессе. Вариант «процесс на клиента» отклонён
 * владельцем (с общей БД два планировщика опубликовали бы пост дважды).
 *
 * ЧТО ЗДЕСЬ ВАЖНО:
 * - `bot.start()` НЕ резолвится, пока бот работает, — его нельзя ждать в цикле,
 *   иначе первый же клиент заблокирует запуск остальных и главного бота.
 * - Сбой одного бота (отозванный токен, 409, порченый шифротекст) — это строка в
 *   `lastError` и живой процесс, а не падение старта.
 * - Реестр создаётся ДО ботов и живёт весь процесс: через него меню поднимает
 *   бота сразу после подключения токена и гасит после отключения (иначе
 *   отключённый бот продолжал бы читать апдейты до ближайшего рестарта).
 * - `getApi(ownerId)` — точка входа маршрутизации публикации в 14b-bis-3.
 */

/** Аккаунт в форме, достаточной для подъёма бота (токен ещё зашифрован). */
export interface LaunchableBotAccount {
  readonly ownerId: string;
  readonly botUserId: string;
  readonly username: string;
  readonly tokenCipher: string;
  /** Telegram-id владельца строкой, как в БД. */
  readonly ownerTelegramUserId: string;
}

/** Зависимости реестра. `buildBot` инъектируется — так реестр тестируется без сети. */
export interface BotRegistryDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  /** `BOT_TOKEN_ENC_KEY`; без него токены нечем расшифровать — ботов не поднимаем. */
  readonly botTokenEncKey: string | undefined;
  /** Сборка бота клиента: тот же набор хендлеров + личность его владельца. */
  readonly buildBot: (token: string, ownerUserId: number) => Bot;
}

export interface OwnerBotRegistry {
  /**
   * Поднимает бота владельца. Повторный вызов заменяет прежнего (замена токена).
   * Никогда не бросает: любой сбой — в `lastError` и в лог.
   */
  launch(account: LaunchableBotAccount): Promise<void>;
  /** Гасит бота владельца (отключение в меню). Нет такого — молча ничего. */
  stop(ownerId: string): Promise<void>;
  /** Api бота владельца для маршрутизации (14b-bis-3); `undefined` — бот не поднят. */
  getApi(ownerId: string): Api | undefined;
  /** Сколько ботов клиентов сейчас работает (лог старта, диагностика). */
  size(): number;
  /** Гасит всех — вызывается на SIGTERM/SIGINT вместе с главным ботом. */
  stopAll(): Promise<void>;
}

interface RunningBot {
  readonly bot: Bot;
  readonly username: string;
}

export function createOwnerBotRegistry(
  deps: BotRegistryDeps,
): OwnerBotRegistry {
  const { prisma, logger, botTokenEncKey, buildBot } = deps;
  const running = new Map<string, RunningBot>();

  const forget = async (ownerId: string): Promise<void> => {
    const entry = running.get(ownerId);
    if (entry === undefined) {
      return;
    }
    running.delete(ownerId);
    try {
      await entry.bot.stop();
    } catch (err) {
      // Бот мог и не успеть запуститься — гасить нечего, это не повод шуметь.
      logger.debug({ err, ownerId }, "остановка бота владельца прошла с ошибкой");
    }
  };

  const fail = async (
    account: LaunchableBotAccount,
    message: string,
  ): Promise<void> => {
    logger.warn(
      { ownerId: account.ownerId, username: account.username, reason: message },
      "бот владельца не поднялся",
    );
    try {
      await markBotAccountError(prisma, account.ownerId, message);
    } catch (err) {
      logger.error({ err, ownerId: account.ownerId }, "не смог записать причину сбоя бота");
    }
  };

  return {
    async launch(account: LaunchableBotAccount): Promise<void> {
      if (botTokenEncKey === undefined) {
        // Ключ пропал из env — токены в БД нечитаемы. Это конфигурация хостинга,
        // а не вина владельца: в `lastError` не пишем, пишем в лог один раз.
        logger.warn(
          { ownerId: account.ownerId },
          "бот владельца пропущен: нет BOT_TOKEN_ENC_KEY",
        );
        return;
      }

      const ownerUserId = parseBotOwnerUserId(account.ownerTelegramUserId);
      if (ownerUserId === null) {
        await fail(account, "нечитаемый Telegram-id владельца");
        return;
      }

      const token = decryptSecret(account.tokenCipher, botTokenEncKey);
      if (token === null) {
        await fail(account, BOT_ERROR_DECRYPT);
        return;
      }

      // Замена токена: сначала гасим прежнего, иначе два long polling на одного
      // владельца подерутся за апдейты.
      await forget(account.ownerId);

      const bot = buildBot(token, ownerUserId);
      // Ошибка хендлера у клиента не должна ронять ни его polling, ни процесс.
      bot.catch((err) => {
        logger.error(
          {
            err: err.error,
            ownerId: account.ownerId,
            update: err.ctx.update.update_id,
          },
          "ошибка обработки апдейта у бота владельца",
        );
      });
      running.set(account.ownerId, { bot, username: account.username });

      // 🔑 НЕ ждём: `bot.start()` резолвится только после остановки бота.
      void bot
        .start({
          onStart: (info) => {
            logger.info(
              { ownerId: account.ownerId, username: info.username },
              "бот владельца запущен",
            );
            void clearBotAccountError(prisma, account.ownerId).catch(
              (err: unknown) => {
                logger.error({ err }, "не смог снять прошлую ошибку бота владельца");
              },
            );
          },
        })
        .catch((err: unknown) => {
          // Сюда приходит и «не приняли токен» на инициализации, и падение
          // long polling позже (409). Бот больше не работает — убираем из реестра,
          // чтобы маршрутизация 14b-bis-3 не адресовала мёртвый Api.
          running.delete(account.ownerId);
          void fail(account, describeBotStartError(err));
        });

      // Синяя кнопка «Menu» у бота клиента — как у главного (best-effort).
      try {
        await bot.api.setMyCommands([
          { command: "menu", description: "Меню управления" },
          { command: "start", description: "Перезапуск + кнопка меню" },
        ]);
      } catch (err) {
        logger.warn(
          { err, ownerId: account.ownerId },
          "не смог установить команды у бота владельца",
        );
      }
    },

    async stop(ownerId: string): Promise<void> {
      await forget(ownerId);
    },

    getApi(ownerId: string): Api | undefined {
      return running.get(ownerId)?.bot.api;
    },

    size(): number {
      return running.size;
    },

    async stopAll(): Promise<void> {
      const ids = [...running.keys()];
      await Promise.allSettled(ids.map((ownerId) => forget(ownerId)));
    },
  };
}

/**
 * Поднимает всех подключённых ботов на старте процесса. Возвращает число тех,
 * кого начали поднимать (успех подтверждает лог `onStart`).
 *
 * Сбой чтения БД не фатален: главный бот должен подняться в любом случае.
 */
export async function startStoredOwnerBots(
  registry: OwnerBotRegistry,
  prisma: PrismaClient,
  logger: Logger,
): Promise<number> {
  let accounts;
  try {
    accounts = await listActiveBotAccounts(prisma);
  } catch (err) {
    logger.error({ err }, "не смог прочитать ботов владельцев");
    return 0;
  }
  for (const account of accounts) {
    await registry.launch(account);
  }
  return accounts.length;
}
