import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  messageToMetric,
  type PostMetricInput,
} from "../../core/analytics/weeklyReport.js";
import { rankTopHours, type TopHour } from "../../core/analytics/topHours.js";

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

/**
 * Сколько последних сообщений канала просматриваем. Шаг 12b расширил окно с 30 до 100:
 * для тренда неделя-к-неделе нужны ДВА окна по 7 дней (текущее + прошлое), а при
 * нескольких постах в день 30 сообщений не покрывают даже двух недель.
 */
const RECENT_MESSAGES_LIMIT = 100;

/** Колбэки интерактивного входа — инъекция, чтобы readline жил в скрипте, а не тут. */
export interface LoginPrompts {
  /** Номер телефона аккаунта (в формате +7…). */
  phone: () => Promise<string>;
  /** Код подтверждения из Telegram. */
  code: () => Promise<string>;
  /** Пароль двухфакторной защиты (если включена). */
  password: () => Promise<string>;
}

/** Колбэки QR-входа — рендер QR и (если включён) пароль 2FA живут в скрипте. */
export interface QrLoginPrompts {
  /** Показать пользователю deeplink `tg://login?token=…` (скрипт рисует его как QR). */
  onQrUrl: (url: string) => Promise<void>;
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
    const metric = messageToMetric(msg);
    if (metric === null) {
      continue; // служебное сообщение без контента
    }
    metrics.push(metric);
  }

  return metrics;
}

/**
 * Читает число подписчиков канала (Шаг 12b) через `channels.getFullChannel` —
 * `fullChat.participantsCount`. Нужен для снимка охвата `ChannelStatSnapshot`.
 * Мягкая деградация: любая ошибка (нет прав/сети/чат — не канал) → `null`, снимок
 * всё равно сохранится с постовыми агрегатами. Клиент должен быть уже подключён.
 *
 * Нативный график лучших часов (`stats.getBroadcastStats`) сюда НЕ входит — вынесен
 * в подшаг 12b-2, чтобы не раздувать текущий шаг (окно/медиа/кнопки/снимок).
 */
export async function fetchSubscriberCount(
  client: TelegramClient,
  channelTarget: string,
): Promise<number | null> {
  try {
    const entity = await client.getEntity(channelTarget);
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: entity }),
    );
    const fullChat = full.fullChat;
    // participantsCount есть только у ChannelFull (не у ChatFull) — сужаем через `in`.
    if ("participantsCount" in fullChat) {
      const count = fullChat.participantsCount;
      return typeof count === "number" ? count : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Читает нативную стату канала `stats.getBroadcastStats` на профильном DC (Шаг 12b-2)
 * с обработкой `STATS_MIGRATE_X` — Telegram держит статистику на отдельном дата-центре
 * и просит переспросить на нём. Возвращает саму стату и id DC (нужен, чтобы догрузить
 * async-граф на том же DC). Ошибка/нет прав → `{ stats: null }`.
 */
async function fetchBroadcastStats(
  client: TelegramClient,
  channel: Api.TypeEntityLike,
): Promise<{ stats: Api.stats.BroadcastStats | null; dcId: number | undefined }> {
  const req = new Api.stats.GetBroadcastStats({ channel });
  try {
    return { stats: await client.invoke(req), dcId: undefined };
  } catch (err) {
    const match = /STATS_MIGRATE_(\d+)/.exec(String(err));
    const dcRaw = match?.[1];
    if (dcRaw !== undefined) {
      const dcId = Number(dcRaw);
      return { stats: await client.invoke(req, dcId), dcId };
    }
    return { stats: null, dcId: undefined };
  }
}

/**
 * Достаёт строку данных графа: у готового `StatsGraph` — прямо из `json.data`; у
 * `StatsGraphAsync` — догружает по токену (`stats.loadAsyncGraph`) на том же DC, что и
 * стата. `StatsGraphError` или иное → `null`.
 */
async function resolveGraphData(
  client: TelegramClient,
  graph: Api.TypeStatsGraph,
  dcId: number | undefined,
): Promise<string | null> {
  if (graph instanceof Api.StatsGraph) {
    return graph.json.data;
  }
  if (graph instanceof Api.StatsGraphAsync) {
    const loaded = await client.invoke(
      new Api.stats.LoadAsyncGraph({ token: graph.token }),
      dcId,
    );
    return loaded instanceof Api.StatsGraph ? loaded.json.data : null;
  }
  return null;
}

/**
 * Нативные «лучшие часы» канала (Шаг 12b-2) — ранжированный `TopHour[]` (best-first) из
 * `topHoursGraph` статы Telegram. Дополняет наш ERR-подбор времени (`bestTime.ts`)
 * данными по всей истории охвата. Мягкая деградация: нет прав/статы/сети → `[]`.
 * Клиент должен быть уже подключён.
 */
export async function fetchTopHours(
  client: TelegramClient,
  channelTarget: string,
): Promise<TopHour[]> {
  try {
    const entity = await client.getEntity(channelTarget);
    const { stats, dcId } = await fetchBroadcastStats(client, entity);
    if (stats === null) {
      return [];
    }
    const data = await resolveGraphData(client, stats.topHoursGraph, dcId);
    return data === null ? [] : rankTopHours(data);
  } catch {
    return [];
  }
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

/**
 * Вход по QR-коду (запасной способ, если код подтверждения из Telegram не доходит).
 * Пользователь сканирует QR в приложении (Настройки → Устройства → Подключить устройство);
 * вводить код руками не нужно. Возвращает строку-сессию, как `loginInteractive`.
 *
 * Особенности GramJS `signInUserWithQrCode`: сам НЕ подключается (сразу `invoke`) — поэтому
 * сначала `connect()`. Токен живёт ~30 c и ротируется: колбэк `qrCode` вызывается повторно
 * с новым токеном → скрипт перерисует QR. При включённой 2FA внутри спросит `password`.
 */
export async function loginInteractiveQr(
  apiId: number,
  apiHash: string,
  prompts: QrLoginPrompts,
): Promise<string> {
  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: CONNECTION_RETRIES,
  });
  try {
    await client.connect();
    await client.signInUserWithQrCode(
      { apiId, apiHash },
      {
        qrCode: async (qr: { token: Buffer; expires: number }) => {
          await prompts.onQrUrl(`tg://login?token=${qr.token.toString("base64url")}`);
        },
        password: prompts.password,
        onError: (err: Error) => {
          console.error("Ошибка входа:", err.message);
        },
      },
    );
    return stringSession.save();
  } finally {
    await client.disconnect();
  }
}
