import type { PrismaClient } from "../client.js";
import type { PostMetricInput } from "../../core/analytics/weeklyReport.js";

/**
 * Доступ к снимкам метрик постов (таблица `PostMetric`, Шаг 7c). Метрики читает
 * джоб отчёта через личный аккаунт (MTProto) и кладёт сюда. Идемпотентность как
 * везде в проекте: upsert по `[channelId, messageId]` — повторный прогон обновляет
 * метрики поста, а не плодит дубли. Чтение истории/трендов — задача Шага 12 (пока YAGNI).
 *
 * Поля снимка — тот же плоский `PostMetricInput` из core, что собирает GramJS-слой.
 */

/** Создаёт или обновляет снимок метрик поста (по каналу + id сообщения). */
export async function upsertPostMetric(
  prisma: PrismaClient,
  channelId: string,
  data: PostMetricInput,
): Promise<void> {
  const values = {
    views: data.views,
    reactions: data.reactions,
    replies: data.replies,
    preview: data.preview,
    postedAt: data.postedAt,
    // Контентные измерения Шага 12b (медиа/кнопки/длина) — обновляем при каждом снимке.
    hasMedia: data.hasMedia,
    hasButtons: data.hasButtons,
    charLen: data.charLen,
  };
  await prisma.postMetric.upsert({
    where: {
      channelId_messageId: { channelId, messageId: data.messageId },
    },
    create: { channelId, messageId: data.messageId, ...values },
    update: values,
  });
}

/**
 * Помечает будущий снимок метрик поста вариантом эксперимента (Шаг 13d). Вызывается
 * при публикации AI-поста, несущего вариант активного эксперимента: создаёт заготовку
 * `PostMetric` с `variantKey`/`origin=ai` (метрики нулевые — их позже наполнит сбор
 * MTProto). Идемпотентно (upsert по `[channelId, messageId]`): `origin`/`variantKey`
 * ставим и в create, и в update; `upsertPostMetric` при сборе метрик эти поля НЕ трогает,
 * так что вариант доживает до вердикта. `messageId` из Bot API == id сообщения в MTProto.
 */
export async function seedVariantMetric(
  prisma: PrismaClient,
  channelId: string,
  messageId: number,
  variantKey: string,
): Promise<void> {
  await prisma.postMetric.upsert({
    where: { channelId_messageId: { channelId, messageId } },
    create: {
      channelId,
      messageId,
      preview: "",
      postedAt: new Date(),
      origin: "ai",
      variantKey,
    },
    update: { origin: "ai", variantKey },
  });
}

/** Снимок метрик поста с вариантом эксперимента (Шаг 13d) — вход вердикта 13a. */
export interface VariantMetricRow {
  readonly variantKey: string;
  readonly views: number;
  readonly reactions: number;
  readonly replies: number;
}

/**
 * Снимки метрик канала, опубликованные не раньше `since` и несущие вариант эксперимента
 * (Шаг 13d). Группируются по `variantKey` в `buildExperimentProgress` → вердикт 13a.
 * Совместим с `EngagementLike` (views/reactions/replies). Посты вне эксперимента отсеяны.
 */
export async function listVariantMetricsSince(
  prisma: PrismaClient,
  channelId: string,
  since: Date,
): Promise<VariantMetricRow[]> {
  const rows = await prisma.postMetric.findMany({
    where: { channelId, postedAt: { gte: since }, variantKey: { not: null } },
    select: { variantKey: true, views: true, reactions: true, replies: true },
  });
  return rows.flatMap((r) =>
    r.variantKey === null
      ? []
      : [{ variantKey: r.variantKey, views: r.views, reactions: r.reactions, replies: r.replies }],
  );
}

/**
 * Читает снимки метрик канала, опубликованные не раньше `since` (Шаг 12b) — источник
 * данных для Content Intelligence. Возвращает плоский `PostMetricInput[]` (тот же тип,
 * что собирает GramJS-слой), отсортированный по дате публикации по возрастанию.
 */
export async function listPostMetricsSince(
  prisma: PrismaClient,
  channelId: string,
  since: Date,
): Promise<PostMetricInput[]> {
  const rows = await prisma.postMetric.findMany({
    where: { channelId, postedAt: { gte: since } },
    orderBy: { postedAt: "asc" },
    select: {
      messageId: true,
      views: true,
      reactions: true,
      replies: true,
      preview: true,
      postedAt: true,
      hasMedia: true,
      hasButtons: true,
      charLen: true,
    },
  });
  return rows;
}
