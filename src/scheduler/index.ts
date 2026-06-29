import { Cron } from "croner";
import {
  publishDueOneOffPosts,
  publishDuePosts,
  type PostingDeps,
} from "../services/postingService.js";

/**
 * Планировщик автопостинга (Шаг 4) — замена APScheduler.
 *
 * Один джоб тикает раз в минуту и спрашивает `publishDueSlots`, какие слоты пора
 * публиковать. Такой «минутный тик» даёт два свойства бесплатно: время слотов можно
 * менять из меню без пересоздания джоба, и после простоя бот догоняет пропущенный
 * слот (условие «время уже прошло, сегодня ещё не постили»).
 */

export interface Scheduler {
  stop(): void;
}

export function startScheduler(deps: PostingDeps): Scheduler {
  const job = new Cron(
    "* * * * *",
    {
      name: "autopost",
      catch: (err: unknown) =>
        deps.logger.error({ err }, "ошибка тика планировщика"),
    },
    async () => {
      await publishDuePosts(deps);
      await publishDueOneOffPosts(deps);
    },
  );
  deps.logger.info("планировщик автопостинга запущен (тик раз в минуту)");
  return {
    stop: () => {
      job.stop();
    },
  };
}
