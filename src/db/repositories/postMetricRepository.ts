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
