import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

/**
 * MTProto-клиент (Шаг 7b) — единственный модуль, который импортирует тяжёлый GramJS.
 * Запущенный бот его НЕ грузит: меню берёт лишь статус из чистого `mtprotoConfig.ts`.
 * Сюда обращаются только скрипт генерации сессии и (позже) джоб отчёта 7c.
 *
 * Порт `analytics.py`/`generate_session.py` (Telethon → GramJS). Логин идёт под
 * ЛИЧНЫМ аккаунтом (не ботом) — токен бота не умеет читать просмотры постов.
 */

/** Сколько раз GramJS пере-подключается при обрыве связи. */
const CONNECTION_RETRIES = 5;

/** Колбэки интерактивного входа — инъекция, чтобы readline жил в скрипте, а не тут. */
export interface LoginPrompts {
  /** Номер телефона аккаунта (в формате +7…). */
  phone: () => Promise<string>;
  /** Код подтверждения из Telegram. */
  code: () => Promise<string>;
  /** Пароль двухфакторной защиты (если включена). */
  password: () => Promise<string>;
}

/**
 * Фабрика клиента по готовой строке-сессии (для smoke и отчёта 7c). Не подключается —
 * вызови `connect()`/`fetchSelfLabel()` сам, чтобы управлять жизненным циклом.
 */
export function createMtprotoClient(
  apiId: number,
  apiHash: string,
  session: string,
): TelegramClient {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
}

/**
 * Smoke/диагностика: подключиться и получить свой аккаунт → человекочитаемая метка
 * (`@username` / имя / id). Доказывает, что строка-сессия рабочая. Соединение
 * оставляем открытым — закрывает вызывающий (для отчёта 7c будет много операций подряд).
 */
export async function fetchSelfLabel(client: TelegramClient): Promise<string> {
  await client.connect();
  const me = await client.getMe();
  const username = me.username;
  if (username !== undefined && username !== "") {
    return `@${username}`;
  }
  const name = [me.firstName, me.lastName]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  return name !== "" ? name : String(me.id);
}

/**
 * Интерактивный одноразовый вход (телефон → код → 2FA) → строка-сессия для вставки
 * в env Railway. Порт `generate_session.py`. Держим свой `StringSession`, т.к.
 * `client.session.save()` типизирован как `void` (абстрактная база), а `StringSession.save()`
 * возвращает строку. По завершении отключаемся — строка уже снята в память.
 */
export async function loginInteractive(
  apiId: number,
  apiHash: string,
  prompts: LoginPrompts,
): Promise<string> {
  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
  try {
    await client.start({
      phoneNumber: prompts.phone,
      phoneCode: prompts.code,
      password: prompts.password,
      onError: (err: Error) => {
        console.error("Ошибка входа:", err.message);
      },
    });
    return stringSession.save();
  } finally {
    await client.disconnect();
  }
}
