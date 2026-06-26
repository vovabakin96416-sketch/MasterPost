import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { PostMetricInput } from "../../core/analytics/weeklyReport.js";

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

/** Сколько последних сообщений канала просматриваем (как `limit=30` в Python). */
const RECENT_MESSAGES_LIMIT = 30;
/** До скольких символов режем превью текста поста (отчёт обрежет ещё короче). */
const PREVIEW_LENGTH = 80;

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
 * Читает метрики постов канала за период (Шаг 7c) — порт цикла `iter_messages` из
 * `weekly_stats_report`. Берём до 30 последних сообщений, останавливаемся, как только
 * упёрлись в посты старше `since`; пропускаем сообщения без текста и медиа (служебные).
 * Возвращаем плоский `PostMetricInput[]` — GramJS-типы наружу не «протекают».
 * Клиент должен быть уже подключён (`connect()`); жизненным циклом управляет вызывающий.
 */
export async function fetchRecentPostMetrics(
  client: TelegramClient,
  channelTarget: string,
  since: Date,
): Promise<PostMetricInput[]> {
  const entity = await client.getEntity(channelTarget);
  const messages = await client.getMessages(entity, {
    limit: RECENT_MESSAGES_LIMIT,
  });
  const sinceMs = since.getTime();
  const metrics: PostMetricInput[] = [];

  for (const msg of messages) {
    const postedAt = new Date(msg.date * 1000);
    if (postedAt.getTime() < sinceMs) {
      break; // сообщения идут от новых к старым — дальше только старее
    }
    const text = msg.message;
    if (text === "" && msg.media === undefined) {
      continue; // служебное сообщение без контента
    }
    const reactions =
      msg.reactions?.results.reduce(
        (sum: number, r) => sum + r.count,
        0,
      ) ?? 0;
    metrics.push({
      messageId: msg.id,
      views: msg.views ?? 0,
      reactions,
      replies: msg.replies?.replies ?? 0,
      preview: text.slice(0, PREVIEW_LENGTH),
      postedAt,
    });
  }

  return metrics;
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
