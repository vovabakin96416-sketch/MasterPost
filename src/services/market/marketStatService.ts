import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import {
  getJsonSetting,
  setJsonSetting,
} from "../../db/repositories/settingRepository.js";
import { getLatestStatSnapshot } from "../../db/repositories/channelStatSnapshotRepository.js";
import type {
  ChannelMarketStat,
  MarketDataProvider,
  SubscriberPoint,
} from "../../core/market/marketData.js";
import {
  MARKET_CACHE_KEY,
  isCacheFresh,
  parseMarketCache,
} from "../../core/market/marketCache.js";
import { buildMarketSection } from "../../core/market/marketSection.js";
import { computeSubscriberDynamics } from "../../core/market/subscriberDynamics.js";

/**
 * Оркестратор рыночного среза (Шаг 12e): кэш в `Setting` + провайдер за
 * интерфейсом. `buildMarketSectionText` зовут экран «📈 Рост» (каждое открытие)
 * и еженедельный отчёт (12e-2) — но лимит Telemetr бережёт кэш (TTL 12ч,
 * `marketCache.ts`): полное обновление = 2 запроса (стата + ряд подписчиков).
 *
 * Мягкая деградация по цепочке: нет провайдера (ключа) / нет публичной ссылки
 * канала / запрос упал и кэша нет → `null` — секции «Рынок» просто нет,
 * остальной экран живёт как раньше (как отчёт без MTProto).
 */

/** Канал в объёме, нужном рыночному срезу. */
export interface MarketChannelRef {
  readonly id: string;
  readonly username: string | null;
  readonly chatId: string | null;
}

/**
 * Публичная ссылка канала для рыночного сервиса: `@username`, иначе `chatId`,
 * если он задан @-именем. Приватный канал (только числовой id) рынку не виден.
 */
function publicRef(channel: MarketChannelRef): string | null {
  if (channel.username !== null && channel.username !== "") {
    return channel.username.startsWith("@")
      ? channel.username
      : `@${channel.username}`;
  }
  if (channel.chatId !== null && channel.chatId.startsWith("@")) {
    return channel.chatId;
  }
  return null;
}

/** Рыночный срез целиком: стата + ряд подписчиков (12e-2, может не собраться). */
export interface MarketData {
  readonly stat: ChannelMarketStat;
  readonly subscribers: readonly SubscriberPoint[] | null;
}

/**
 * Отдаёт рыночный срез канала: свежий кэш → без запросов; протух → запросы к
 * провайдеру (стата + ряд подписчиков) и обновление кэша; стата упала →
 * протухший кэш (старые данные лучше, чем ничего), совсем пусто → `null`.
 * Упал только ряд подписчиков → стата свежая, ряд берём из старого кэша.
 */
export async function getMarketData(
  prisma: PrismaClient,
  logger: Logger,
  channel: MarketChannelRef,
  provider: MarketDataProvider,
  now: Date = new Date(),
): Promise<MarketData | null> {
  const cached = parseMarketCache(
    await getJsonSetting(prisma, channel.id, MARKET_CACHE_KEY),
  );
  if (cached !== null && isCacheFresh(cached.fetchedAt, now)) {
    return { stat: cached.stat, subscribers: cached.subscribers };
  }

  const ref = publicRef(channel);
  if (ref === null) {
    return null;
  }
  const fresh = await provider.fetchChannelStat(ref);
  if (fresh === null) {
    if (cached !== null) {
      logger.warn("рыночный срез: запрос не удался, показываю протухший кэш");
      return { stat: cached.stat, subscribers: cached.subscribers };
    }
    return null;
  }
  // 12e-2: ряд подписчиков — второй запрос того же обновления (2 запроса / 12ч).
  const subscribers =
    (await provider.fetchSubscriberHistory(ref)) ?? cached?.subscribers ?? null;
  // Спреды — Prisma InputJsonValue не принимает интерфейс без индекс-сигнатуры.
  await setJsonSetting(prisma, channel.id, MARKET_CACHE_KEY, {
    fetchedAt: now.toISOString(),
    stat: { ...fresh },
    ...(subscribers === null
      ? {}
      : { subscribers: subscribers.map((p) => ({ ...p })) }),
  });
  return { stat: fresh, subscribers };
}

/**
 * Текст секции «🌍 Рынок» (экран «📈 Рост» + еженедельный отчёт, 12e-2):
 * рыночный срез + динамика подписчиков + сравнение со своим ERR из последнего
 * снимка охвата (12b). Нет данных → `null` (секции нет).
 */
export async function buildMarketSectionText(
  prisma: PrismaClient,
  logger: Logger,
  channel: MarketChannelRef,
  provider: MarketDataProvider | null,
  now: Date = new Date(),
): Promise<string | null> {
  if (provider === null) {
    return null;
  }
  const data = await getMarketData(prisma, logger, channel, provider, now);
  if (data === null) {
    return null;
  }
  const snapshot = await getLatestStatSnapshot(prisma, channel.id);
  const dynamics =
    data.subscribers === null
      ? null
      : computeSubscriberDynamics(data.subscribers, now);
  return buildMarketSection(
    data.stat,
    { avgErr7d: snapshot?.avgErr7d ?? null },
    dynamics,
  );
}
