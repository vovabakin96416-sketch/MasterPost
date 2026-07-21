import { Api } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import { validateBotToken } from "../core/menu/botToken.js";
import { encryptSecret } from "../core/security/tokenCipher.js";
import {
  findBotAccountByBotUserId,
  saveBotAccount,
  type BotAccountRecord,
} from "../db/repositories/botAccountRepository.js";

/**
 * Подключение своего бота клиенту (Шаг 14b-bis-1).
 *
 * Единственное место, которое знает и про ключ шифрования, и про Bot API: ядро
 * проверяет форму токена, репозиторий хранит шифротекст, а «живой ли токен и чей
 * он» выясняется здесь одним вызовом `getMe`.
 *
 * ⚠️ Токен НЕ логируется ни при каком исходе — в лог идут только id/username бота.
 */

export interface BotAccountDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  /** `BOT_TOKEN_ENC_KEY`; без него подключение недоступно (`no_key`). */
  readonly botTokenEncKey: string | undefined;
  /** id общего бота (префикс `BOT_TOKEN`) — его подключать себе нельзя. */
  readonly mainBotUserId: string | undefined;
}

export type ConnectBotOutcome =
  /** Не настроен ключ шифрования — хранить токен нам негде и не во что. */
  | { readonly kind: "no_key" }
  /** Форма токена не та (ядро) — несём текст ошибки владельцу как есть. */
  | { readonly kind: "bad_format"; readonly error: string }
  /** Telegram не принял токен: опечатка, отозван в BotFather, нет сети. */
  | { readonly kind: "invalid_token" }
  /** Это токен общего бота — второй long polling на нём убил бы обоих (409). */
  | { readonly kind: "main_bot" }
  /** Бот уже подключён другим владельцем — тот же 409, только между клиентами. */
  | { readonly kind: "taken" }
  | { readonly kind: "ok"; readonly account: BotAccountRecord };

/** Таймаут `getMe`: владелец ждёт ответа в чате, зависший запрос хуже отказа. */
const GET_ME_TIMEOUT_SECONDS = 15;

/**
 * Проверяет токен и сохраняет его владельцу (замена прежнего, если был).
 *
 * Порядок проверок — от дешёвых к дорогим и от безопасных к записывающим:
 * ключ → форма → «не общий бот» → `getMe` → «не занят другим» → запись.
 */
export async function connectBotAccount(
  deps: BotAccountDeps,
  ownerId: string,
  input: string,
): Promise<ConnectBotOutcome> {
  const { prisma, logger, botTokenEncKey, mainBotUserId } = deps;
  if (botTokenEncKey === undefined) {
    return { kind: "no_key" };
  }

  const parsed = validateBotToken(input);
  if (!parsed.ok) {
    return { kind: "bad_format", error: parsed.error };
  }
  const { token, botUserId } = parsed.value;

  if (mainBotUserId !== undefined && botUserId === mainBotUserId) {
    return { kind: "main_bot" };
  }

  const me = await fetchBotIdentity(token, logger);
  if (me === null) {
    return { kind: "invalid_token" };
  }

  // Сверяем id из токена с ответом Telegram: расходятся — токен не тот, за кого
  // себя выдаёт, и дальше пускать его нельзя (по id мы разводим ботов в 14b-bis-2).
  if (me.botUserId !== botUserId) {
    return { kind: "invalid_token" };
  }

  const existing = await findBotAccountByBotUserId(prisma, me.botUserId);
  if (existing !== null && existing.ownerId !== ownerId) {
    return { kind: "taken" };
  }

  const account = await saveBotAccount(prisma, {
    ownerId,
    botUserId: me.botUserId,
    username: me.username,
    tokenCipher: encryptSecret(token, botTokenEncKey),
  });
  logger.info(
    { ownerId, botUserId: me.botUserId, username: me.username },
    "подключён бот владельца",
  );
  return { kind: "ok", account };
}

interface BotIdentity {
  readonly botUserId: string;
  readonly username: string;
}

/**
 * Спрашивает у Telegram, чей это токен. `null` на любой проблеме (401, сеть,
 * таймаут, вдруг не бот) — владельцу мы всё равно скажем одно: «токен не принят».
 */
async function fetchBotIdentity(
  token: string,
  logger: Logger,
): Promise<BotIdentity | null> {
  try {
    const api = new Api(token, { timeoutSeconds: GET_ME_TIMEOUT_SECONDS });
    const me = await api.getMe();
    // `getMe` по контракту Bot API отдаёт бота с username; пустое значение —
    // признак нештатного ответа, тогда лучше отказать, чем сохранить пустышку.
    if (me.username.length === 0) {
      return null;
    }
    return { botUserId: String(me.id), username: me.username };
  } catch (err) {
    // Логируем ошибку, но не токен: сообщения Bot API его не содержат.
    logger.warn({ err }, "getMe не принял токен клиента");
    return null;
  }
}
