import { Cron } from "croner";
import { runContentEndingCheck } from "../services/analyticsService.js";
import {
  runWeeklyReport,
  type WeeklyReportDeps,
} from "../services/analytics/weeklyReportService.js";

/**
 * Планировщик аналитики. Отдельный от автопостинга (scheduler/index.ts) — аналитика
 * остаётся изолированным модулем.
 *
 * Два джоба (оба — порт `analytics.py`):
 *  - ВС 21:00 МСК — напоминание о конце контента (Шаг 7a), если идёт последняя неделя.
 *  - ПН 09:30 МСК — отчёт по просмотрам постов за прошлую неделю (Шаг 7c). Если MTProto
 *    не настроен — джоб тихо ничего не делает (бот работает как раньше).
 *
 * ⚠️ Изоляция: этот модуль НЕ импортирует GramJS статически. Отчёт грузит `mtprotoClient`
 * динамически внутри `runWeeklyReport` — при старте бота GramJS не подтягивается.
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

  deps.logger.info(
    "планировщик аналитики запущен (напоминание ВС 21:00 МСК, отчёт ПН 09:30 МСК)",
  );
  return {
    stop: () => {
      contentEndingJob.stop();
      weeklyReportJob.stop();
    },
  };
}
