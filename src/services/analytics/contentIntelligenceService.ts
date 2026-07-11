import type { Logger } from "pino";
import type { PrismaClient } from "../../db/client.js";
import { getPostingChannel } from "../../db/repositories/channelRepository.js";
import {
  listPostMetricsSince,
  upsertPostMetric,
} from "../../db/repositories/postMetricRepository.js";
import {
  createStatSnapshot,
  listRecentStatSnapshots,
  type StatSnapshotRow,
} from "../../db/repositories/channelStatSnapshotRepository.js";
import { buildInsights, type Insights } from "../../core/analytics/insights.js";
import { periodStat } from "../../core/analytics/trend.js";
import {
  contentDimensionStats,
  type ContentDimensionStats,
} from "../../core/analytics/dimensions.js";
import {
  buildAdvice,
  type SnapshotSummary,
} from "../../core/analytics/advisor.js";
import { buildInsightsReport } from "../../core/analytics/insightsReport.js";
import { sortTopHours } from "../../core/analytics/topHours.js";
import { localDateParts } from "../../core/schedule/localDate.js";
import { isMtprotoConfigured, type MtprotoConfig } from "./mtprotoConfig.js";

/**
 * Сервис Content Intelligence (Шаг 12b) — соединяет данные с ядром 12a.
 *
 * Две роли:
 *  1. `buildChannelIntelligence` — ЧИТАЕТ из БД (`PostMetric` + `ChannelStatSnapshot`) и
 *     строит структурные выводы `Insights` через ядро 12a. 0 токенов, без MTProto —
 *     это то, что отчёт (12c) и экран «📈 Рост» покажут владельцу.
 *  2. `runStatSnapshot` — ДЖОБ: под личным аккаунтом (MTProto) снимает свежие метрики,
 *     сохраняет их и кладёт снимок агрегатов `ChannelStatSnapshot` (тренд охвата).
 *
 * ⚠️ Изоляция (принцип 7b): тяжёлый GramJS грузится только динамическим `import()`
 * внутри джоба и лишь когда MTProto настроен. Чтение из БД (роль 1) GramJS не трогает.
 */

/** Окно анализа — 7 дней (как еженедельный отчёт). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Зависимости джоба снимка: БД, логгер, конфиг MTProto. */
export interface StatSnapshotDeps {
  prisma: PrismaClient;
  logger: Logger;
  mtproto: MtprotoConfig;
}

/**
 * Выводы аналитики канала + контентные измерения + два последних снимка охвата (для 12c).
 * `latestSnapshot`/`previousSnapshot` — для нативных часов и Δ подписчиков между снимками.
 */
export interface ChannelIntelligence {
  readonly insights: Insights;
  readonly contentStats: ContentDimensionStats;
  readonly latestSnapshot: StatSnapshotRow | null;
  readonly previousSnapshot: StatSnapshotRow | null;
}

/**
 * Строит выводы канала из уже собранных метрик (роль 1, БД-only). Делит два окна по
 * 7 дней (текущее против прошлого) для тренда, отдаёт `Insights` ядра 12a, контентные
 * измерения текущего окна и два последних снимка охвата. `now` инъектируется для тестов.
 */
export async function buildChannelIntelligence(
  prisma: PrismaClient,
  channelId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<ChannelIntelligence> {
  const nowMs = now.getTime();
  const currentSince = new Date(nowMs - WEEK_MS);
  const previousSince = new Date(nowMs - 2 * WEEK_MS);

  const twoWeeks = await listPostMetricsSince(prisma, channelId, previousSince);
  const current = twoWeeks.filter((m) => m.postedAt >= currentSince);
  const previous = twoWeeks.filter((m) => m.postedAt < currentSince);

  const insights = buildInsights(current, previous, timezone);
  const contentStats = contentDimensionStats(current);
  const snapshots = await listRecentStatSnapshots(prisma, channelId, 2);
  return {
    insights,
    contentStats,
    latestSnapshot: snapshots[0] ?? null,
    previousSnapshot: snapshots[1] ?? null,
  };
}

/**
 * Приводит нативные лучшие часы Telegram (UTC, как отдаёт стата) к часам в поясе канала
 * и собирает сводку снимка для советника. Пустой снимок → нет нативных часов.
 */
function toSnapshotSummary(
  latest: StatSnapshotRow | null,
  previous: StatSnapshotRow | null,
  timezone: string,
): SnapshotSummary {
  const nativeTopHoursLocal = sortTopHours(latest?.topHours ?? []).map((h) =>
    utcHourToLocal(h.hour, timezone),
  );
  return {
    nativeTopHoursLocal,
    subscribers: latest?.subscribers ?? null,
    previousSubscribers: previous?.subscribers ?? null,
  };
}

/** Переводит «час суток UTC» (0..23) в час суток в поясе канала (детерминированно). */
function utcHourToLocal(utcHour: number, timezone: string): number {
  // Любой опорный день — важен только сдвиг пояса; берём фиксированную дату.
  const at = new Date(Date.UTC(2001, 0, 1, utcHour, 0, 0));
  return localDateParts(at, timezone).hour;
}

/**
 * Отчёт «📈 Рост» (роль 1, БД-only, 0 токенов): поверх `buildChannelIntelligence` строит
 * рекомендации советника и форматирует человекочитаемый текст. Используется и на экране
 * меню, и как секция еженедельного отчёта.
 */
export async function buildGrowthReport(
  prisma: PrismaClient,
  channelId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<string> {
  const intel = await buildChannelIntelligence(prisma, channelId, timezone, now);
  const summary = toSnapshotSummary(
    intel.latestSnapshot,
    intel.previousSnapshot,
    timezone,
  );
  const advice = buildAdvice(intel.insights, intel.contentStats, summary);
  return buildInsightsReport(intel.insights, advice, summary.nativeTopHoursLocal);
}

/**
 * Собирает свежие метрики канала за 7 дней (MTProto), сохраняет их и считает агрегаты
 * снимка охвата. Динамический импорт GramJS — здесь. Соединение всегда закрываем.
 */
async function collectSnapshot(
  deps: StatSnapshotDeps,
  channelId: string,
  chatId: string,
  cfg: { apiId: number; apiHash: string; session: string },
): Promise<void> {
  const {
    createMtprotoClient,
    fetchRecentPostMetrics,
    fetchSubscriberCount,
    fetchTopHours,
  } = await import("./mtprotoClient.js");
  const client = createMtprotoClient(cfg.apiId, cfg.apiHash, cfg.session);
  try {
    await client.connect();
    const since = new Date(Date.now() - WEEK_MS);
    const metrics = await fetchRecentPostMetrics(client, chatId, since);
    for (const metric of metrics) {
      await upsertPostMetric(deps.prisma, channelId, metric);
    }
    const subscribers = await fetchSubscriberCount(client, chatId);
    const topHours = await fetchTopHours(client, chatId);
    const stat = periodStat(metrics);
    await createStatSnapshot(deps.prisma, channelId, {
      subscribers,
      postCount7d: stat.count,
      avgViews7d: Math.round(stat.avgViews),
      avgErr7d: stat.avgErr,
      topHours,
    });
  } finally {
    // destroy(), а не disconnect(): при мёртвой сессии update-loop GramJS иначе
    // бесконечно спамит тайм-аутами (как в weeklyReportService).
    await client.destroy();
  }
}

/**
 * Тик планировщика (раз в сутки): снять снимок агрегатов канала для тренда охвата.
 * Если MTProto не настроен или нет канала — тихо (мягкая деградация, как отчёт 7c).
 * Ошибки логируем, но не роняем планировщик.
 */
export async function runStatSnapshot(deps: StatSnapshotDeps): Promise<void> {
  const cfg = deps.mtproto;
  if (!isMtprotoConfigured(cfg)) {
    return;
  }
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null || channel.chatId === null) {
    return;
  }
  try {
    await collectSnapshot(deps, channel.id, channel.chatId, cfg);
    deps.logger.info("сохранён снимок охвата канала (ChannelStatSnapshot)");
  } catch (err) {
    deps.logger.error({ err }, "ошибка снимка охвата канала");
  }
}
