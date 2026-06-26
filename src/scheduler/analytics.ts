import { Cron } from "croner";
import {
  runContentEndingCheck,
  type AnalyticsDeps,
} from "../services/analyticsService.js";

/**
 * Планировщик аналитики (Шаг 7a). Отдельный от автопостинга (scheduler/index.ts) —
 * аналитика остаётся изолированным модулем.
 *
 * Пока один джоб: каждое воскресенье в 21:00 МСК проверяем, не идёт ли последняя
 * неделя контент-плана, и при необходимости шлём владельцу напоминание (порт
 * `analytics.py:check_content_ending`). В 7c сюда добавится отчёт по просмотрам
 * (ПН 09:30 МСК).
 */

/** Таймзона джобов аналитики — как в Python-боте (МСК). */
const ANALYTICS_TZ = "Europe/Moscow";

export interface Scheduler {
  stop(): void;
}

export function startAnalyticsScheduler(deps: AnalyticsDeps): Scheduler {
  const job = new Cron(
    "0 21 * * 0",
    {
      name: "content-ending-check",
      timezone: ANALYTICS_TZ,
      catch: (err: unknown) =>
        deps.logger.error({ err }, "ошибка джоба напоминания о конце контента"),
    },
    async () => {
      await runContentEndingCheck(deps);
    },
  );
  deps.logger.info("планировщик аналитики запущен (напоминание ВС 21:00 МСК)");
  return {
    stop: () => {
      job.stop();
    },
  };
}
