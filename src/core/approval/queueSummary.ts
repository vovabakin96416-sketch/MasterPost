/**
 * Расшифровка очереди одобрения — ЧИСТАЯ логика (без grammY/БД).
 *
 * Экран показывал голое «Ждут одобрения: 13»: непонятно, что это за посты, откуда они
 * взялись и почему их столько. Здесь считаем разбивку по источнику и возраст очереди —
 * ровно то, что отвечает на вопрос «что за 13».
 *
 * Источник различаем по `externalId`: `null` → пост сочинил AI, иначе это пост
 * контент-плана (см. `PendingPost.externalId` в схеме).
 */

import { pluralRu } from "../text/pluralRu.js";

/** Элемент очереди в объёме разбивки. */
export interface QueueItem {
  readonly externalId: number | null;
  readonly createdAt: Date;
}

export interface QueueSummary {
  readonly total: number;
  /** Посты контент-плана (у них есть `externalId`). */
  readonly fromPlan: number;
  /** Посты, сочинённые AI. */
  readonly fromAi: number;
  /** Дата самого старого поста в очереди; `null` — очередь пуста. */
  readonly oldest: Date | null;
}

/** Считает разбивку очереди: сколько всего, откуда пришли, с какого числа висят. */
export function summarisePendingQueue(items: readonly QueueItem[]): QueueSummary {
  let fromPlan = 0;
  let oldest: Date | null = null;
  for (const item of items) {
    if (item.externalId !== null) {
      fromPlan += 1;
    }
    if (oldest === null || item.createdAt.getTime() < oldest.getTime()) {
      oldest = item.createdAt;
    }
  }
  return {
    total: items.length,
    fromPlan,
    fromAi: items.length - fromPlan,
    oldest,
  };
}

const POSTS_FORMS = ["пост", "поста", "постов"] as const;
const WAIT_FORMS = ["ждёт", "ждут", "ждут"] as const;

/**
 * Человеческая строка-расшифровка под счётчиком. `oldestLabel` — уже отформатированная
 * дата самого старого поста (формат даты зависит от пояса канала, поэтому его считает
 * вызывающий; ядро не лезет в настройки канала).
 */
export function buildQueueSummaryLine(
  summary: QueueSummary,
  oldestLabel: string | null,
): string {
  if (summary.total === 0) {
    return "Очередь пуста — все посты разобраны.";
  }
  const n = summary.total;
  const parts = [
    `${String(n)} ${pluralRu(n, POSTS_FORMS)} ${pluralRu(n, WAIT_FORMS)} решения`,
  ];
  const sources: string[] = [];
  if (summary.fromPlan > 0) {
    sources.push(`${String(summary.fromPlan)} из плана`);
  }
  if (summary.fromAi > 0) {
    sources.push(`${String(summary.fromAi)} от AI`);
  }
  if (sources.length > 0) {
    parts.push(sources.join(", "));
  }
  if (oldestLabel !== null) {
    parts.push(`самый старый от ${oldestLabel}`);
  }
  return parts.join(" · ");
}
