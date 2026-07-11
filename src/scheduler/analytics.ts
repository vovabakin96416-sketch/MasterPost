import { Cron } from "croner";
import { runContentEndingCheck } from "../services/analyticsService.js";
import {
  runWeeklyReport,
  type WeeklyReportDeps,
} from "../services/analytics/weeklyReportService.js";
import { runStatSnapshot } from "../services/analytics/contentIntelligenceService.js";

/**
 * Планировщик аналитики. Отдельный от автопостинга (scheduler/index.ts) — аналитика
 * остаётся изолированным модулем.
 *
 * Три джоба:
 *  - ВС 21:00 МСК — напоминание о конце контента (Шаг 7a), если идёт последняя неделя.
 *  - ПН 09:30 МСК — отчёт по просмотрам постов за прошлую неделю (Шаг 7c). Если MTProto
 *    не настроен — джоб тихо ничего не делает (бот работает как раньше).
 *  - Ежедневно 22:00 МСК — снимок агрегатов канала (Шаг 12b, `ChannelStatSnapshot`) для
 *    тренда охвата. Тоже тихо без MTProto.
 *
 * ⚠️ Изоляция: этот модуль НЕ импортирует GramJS статически. Отчёт и снимок грузят
 * `mtprotoClient` динамически внутри своих `run*` — при старте бота GramJS не подтягивается.
 */

/** Таймзона джобов аналитики — как в Python-боте (МСК). */
const ANALYTICS_TZ = "Europe/Moscow";

export interface Scheduler {
  stop(): void;
}

export function startAnalyticsScheduler(deps: WeeklyReportDeps): Scheduler {
  const contentEndingJob = new Cron(
    "0 21 * * 0",
    {
      name: "content-ending-check",
      timezone: ANALYTICS_TZ,
      protect: true, // не наслаивать тик на ещё идущий предыдущий
      catch: (err: unknown) =>
        deps.logger.error({ err }, "ошибка джоба напоминания о конце контента"),
    },
    async () => {
      await runContentEndingCheck(deps);
    },
  );

  const weeklyReportJob = new Cron(
    "30 9 * * 1",
    {
      name: "weekly-views-report",
      timezone: ANALYTICS_TZ,
      protect: true, // MTProto-сбор может идти долго — не наслаивать повторный тик
      catch: (err: unknown) =>
        deps.logger.error({ err }, "ошибка джоба отчёта по просмотрам"),
    },
    async () => {
      await runWeeklyReport(deps);
    },
  );

  const statSnapshotJob = new Cron(
    "0 22 * * *",
    {
      name: "channel-stat-snapshot",
      timezone: ANALYTICS_TZ,
      protect: true, // MTProto-сбор может идти долго — не наслаивать повторный тик
      catch: (err: unknown) =>
        deps.logger.error({ err }, "ошибка джоба снимка охвата канала"),
    },
    async () => {
      await runStatSnapshot(deps);
    },
  );

  deps.logger.info(
    "планировщик аналитики запущен (напоминание ВС 21:00, отчёт ПН 09:30, снимок ежедн. 22:00 МСК)",
  );
  return {
    stop: () => {
      contentEndingJob.stop();
      weeklyReportJob.stop();
      statSnapshotJob.stop();
    },
  };
}
