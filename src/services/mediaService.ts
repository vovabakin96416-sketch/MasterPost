import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import { getJsonSetting } from "../db/repositories/settingRepository.js";
import { planPhoto, type PhotoSources } from "../core/media/resolvePriority.js";
import type { MediaTier, PhotoRef } from "../core/media/types.js";
import type { MediaProvider, ProviderContext } from "./media/provider.js";
import { pexelsProvider } from "./media/pexelsProvider.js";
import { genProvider } from "./media/genProvider.js";

/**
 * Сервис подбора фото (Шаг 6a) — оркестрирует чистый приоритет (`planPhoto`) и
 * провайдеров (Pexels / генерация) под обе версии продукта. Изолирован от Telegram:
 * возвращает `PhotoRef`, а слать в чат — дело `postingService`.
 *
 * Тариф канала живёт в настройке `media_tier` (дефолт `free`). Платный тариф
 * (генерация) пока заглушка с откатом на сток, поэтому канал не остаётся без фото.
 */

/** Ключ настройки тарифа медиа. */
export const MEDIA_TIER_KEY = "media_tier";

/** По умолчанию — бесплатная версия (сток). */
export const DEFAULT_MEDIA_TIER: MediaTier = "free";

/** Зависимости медиа-сервиса (подмножество `PostingDeps` — можно передавать его). */
export interface MediaDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  readonly pexelsApiKey: string | undefined;
}

/** Читает тариф канала из настроек (значение не `paid` → `free`). */
export async function getMediaTier(
  prisma: PrismaClient,
  channelId: string,
): Promise<MediaTier> {
  const raw = await getJsonSetting(prisma, channelId, MEDIA_TIER_KEY);
  return raw === "paid" ? "paid" : "free";
}

/** Провайдер по тарифу: бесплатный → Pexels, платный → генерация (заглушка). */
export function providerFor(tier: MediaTier): MediaProvider {
  return tier === "paid" ? genProvider : pexelsProvider;
}

/**
 * Подбирает фото по запросу согласно тарифу канала. Платный провайдер при неудаче
 * (пока — всегда, заглушка) откатывается на сток. Возвращает URL или `null`.
 */
export async function fetchPhotoUrl(
  deps: MediaDeps,
  channelId: string,
  query: string,
): Promise<string | null> {
  const tier = await getMediaTier(deps.prisma, channelId);
  const ctx: ProviderContext = { logger: deps.logger, apiKey: deps.pexelsApiKey };

  const url = await providerFor(tier).fetch(query, ctx);
  if (url !== null || tier === "free") {
    return url;
  }
  // Платный провайдер не дал фото → откат на сток, чтобы не остаться без картинки.
  return pexelsProvider.fetch(query, ctx);
}

/**
 * Резолвит фото поста: сперва чистый приоритет источника (`planPhoto`), затем при
 * необходимости запрос к провайдеру. `null` — публикуем без фото.
 */
export async function resolvePhoto(
  deps: MediaDeps,
  channelId: string,
  sources: PhotoSources,
): Promise<PhotoRef | null> {
  const plan = planPhoto(sources);
  if (plan.kind === "ready") {
    return plan.ref;
  }
  if (plan.kind === "none") {
    return null;
  }
  const url = await fetchPhotoUrl(deps, channelId, plan.query);
  return url === null ? null : { kind: "url", url };
}

/**
 * Строковое представление фото для кэша в `PendingPost.photoUrl`: URL или Telegram
 * file_id шлются как строка. Локальный путь не кэшируем (его резолвим заново) → `null`.
 */
export function refToCacheString(ref: PhotoRef | null): string | null {
  if (ref === null) {
    return null;
  }
  switch (ref.kind) {
    case "url":
      return ref.url;
    case "fileId":
      return ref.fileId;
    case "path":
      return null;
  }
}
