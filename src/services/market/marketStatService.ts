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
} from "../../core/market/marketData.js";
import {
  MARKET_CACHE_KEY,
  isCacheFresh,
  parseMarketCache,
} from "../../core/market/marketCache.js";
import { buildMarketSection } from "../../core/market/marketSection.js";

/**
 * Оркестратор рыночного среза (Шаг 12e): кэш в `Setting` + провайдер за
 * интерфейсом. Экран «📈 Рост» зовёт `buildMarketSectionText` при каждом
 * открытии — но лимит Telemetr бережёт кэш (TTL 12ч, `marketCache.ts`).
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

/**
 * Отдаёт рыночный срез канала: свежий кэш → без запроса; протух → запрос к
 * провайдеру и обновление кэша; запрос упал → протухший кэш (старые данные
 * лучше, чем ничего), совсем пусто → `null`.
 */
export async function getMarketStat(
  prisma: PrismaClient,
  logger: Logger,
  channel: MarketChannelRef,
  provider: MarketDataProvider,
  now: Date = new Date(),
): Promise<ChannelMarketStat | null> {
  const cached = parseMarketCache(
    await getJsonSetting(prisma, channel.id, MARKET_CACHE_KEY),
  );
  if (cached !== null && isCacheFresh(cached.fetchedAt, now)) {
    return cached.stat;
  }

  const ref = publicRef(channel);
  if (ref === null) {
    return null;
  }
  const fresh = await provider.fetchChannelStat(ref);
  if (fresh === null) {
    if (cached !== null) {
      logger.warn("рыночный срез: запрос не удался, показываю протухший кэш");
    }
    return cached?.stat ?? null;
  }
  // Спред — Prisma InputJsonValue не принимает интерфейс без индекс-сигнатуры.
  await setJsonSetting(prisma, channel.id, MARKET_CACHE_KEY, {
    fetchedAt: now.toISOString(),
    stat: { ...fresh },
  });
  return fresh;
}

/**
 * Текст секции «🌍 Рынок» для экрана «📈 Рост»: рыночный срез + сравнение со
 * своим ERR из последнего снимка охвата (12b). Нет данных → `null` (секции нет).
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
  const stat = await getMarketStat(prisma, logger, channel, provider, now);
  if (stat === null) {
    return null;
  }
  const snapshot = await getLatestStatSnapshot(prisma, channel.id);
  return buildMarketSection(stat, { avgErr7d: snapshot?.avgErr7d ?? null });
}
