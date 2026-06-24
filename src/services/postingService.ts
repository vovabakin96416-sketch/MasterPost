import { type Api, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import {
  getPostsForDay,
  type PostToPublish,
} from "../db/repositories/postRepository.js";
import {
  getPostingChannel,
  type PostingChannel,
} from "../db/repositories/channelRepository.js";
import { localDateParts } from "../core/schedule/localDate.js";
import { resolveCampaignDay } from "../core/schedule/resolveCampaignDay.js";
import { dueTimes } from "../core/schedule/times.js";
import { readAutopostConfig, saveProgress } from "./autopostSettings.js";

/**
 * Сервис публикации постов (Шаг 4 / Доработка 4.1 — порт `send_post`).
 *
 * Изолирован от Telegram-слоя: принимает `bot.api` как зависимость, поэтому
 * вызывается и из планировщика (по расписанию), и из меню («Опубликовать сейчас»).
 * На Шаге 4 шлём только текст; фото (Шаги 5–6) и кнопки (Шаг 6) добавятся здесь же.
 *
 * Расписание — произвольный список времён: посты дня (по их `time`) публикуются по
 * порядку в заданные времена. Индекс поста = число уже опубликованных сегодня.
 */

/** Зависимости публикации: БД, логгер, Telegram API и id админа для уведомлений. */
export interface PostingDeps {
  prisma: PrismaClient;
  logger: Logger;
  api: Api;
  adminId: number;
}

/** Собирает текст поста: `*title*` + текст + CTA (порт `send_post`). */
export function buildPostMessage(post: PostToPublish): string {
  return `*${post.title}*\n\n${post.text}\n\n${post.cta}`.trim();
}

/**
 * Отправка с Markdown и откатом на простой текст, если разметка ломается
 * (порт `safe_send`): кривой `_`/`*` в тексте не должен срывать публикацию.
 */
export async function safeSend(
  api: Api,
  chatId: string | number,
  text: string,
): Promise<void> {
  try {
    await api.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await api.sendMessage(chatId, text);
      return;
    }
    throw err;
  }
}

/** Уведомление админу простым текстом; ошибку доставки только логируем. */
async function notifyAdmin(deps: PostingDeps, text: string): Promise<void> {
  try {
    await deps.api.sendMessage(deps.adminId, text);
  } catch (err) {
    deps.logger.error({ err }, "не смог уведомить админа");
  }
}

/** Считает неделю/день канала на текущий момент (по его поясу). */
function resolveNow(channel: PostingChannel): {
  today: ReturnType<typeof localDateParts>;
  week: number;
} {
  const today = localDateParts(new Date(), channel.timezone);
  const start =
    channel.campaignStart === null
      ? null
      : localDateParts(channel.campaignStart, channel.timezone);
  const { week } = resolveCampaignDay(today, start);
  return { today, week };
}

/**
 * Тик планировщика: публикует посты дня в наступившие времена. Дедуп по локальной
 * дате (прогресс `{date, postedTimes}`): время отрабатывается раз в день, после
 * простоя — догоняет. Индекс поста = число уже опубликованных сегодня.
 */
export async function publishDuePosts(deps: PostingDeps): Promise<void> {
  const { prisma, logger, api } = deps;
  const channel = await getPostingChannel(prisma);
  if (channel === null) {
    return;
  }
  const config = await readAutopostConfig(prisma, channel.id);
  if (!config.enabled) {
    return;
  }

  const { today, week } = resolveNow(channel);
  const due = dueTimes(today, config.times, config.progress);
  if (due.length === 0) {
    return;
  }

  // Уже отработанные сегодня времена (для продолжения нумерации постов в течение дня).
  const posted =
    config.progress.date === today.isoDate ? [...config.progress.postedTimes] : [];

  // Автопостинг включён, но цель не задана — один раз предупреждаем и помечаем.
  if (channel.chatId === null) {
    await saveProgress(prisma, channel.id, {
      date: today.isoDate,
      postedTimes: [...posted, ...due],
    });
    await notifyAdmin(
      deps,
      "⚠️ Автопостинг включён, но канал публикации не задан. Откройте «📅 Автопостинг → 📡 Указать канал».",
    );
    return;
  }

  const posts = await getPostsForDay(prisma, channel.id, week, today.weekday);
  for (const time of due) {
    const idx = posted.length;
    const post = posts[idx];
    try {
      if (post !== undefined) {
        await safeSend(api, channel.chatId, buildPostMessage(post));
        logger.info(
          { channelId: channel.id, week, day: today.weekday, time, idx },
          "пост опубликован (авто)",
        );
      } else if (idx === 0) {
        await notifyAdmin(
          deps,
          `⚠️ Нет постов на сегодня. Неделя ${String(week)}, день ${today.weekday}. Проверьте контент-план.`,
        );
        logger.warn({ week, day: today.weekday, time }, "нет постов на сегодня");
      } else {
        logger.info({ week, time, idx }, "постов на сегодня меньше, чем времён — пропуск");
      }
    } catch (err) {
      logger.error({ err, time }, "ошибка публикации");
    } finally {
      posted.push(time);
    }
  }
  await saveProgress(prisma, channel.id, { date: today.isoDate, postedTimes: posted });
}

/** Результат ручной публикации (для тоста/экрана меню). */
export type PublishNowResult =
  | { ok: true; week: number }
  | { ok: false; reason: "no_channel" | "no_target" | "no_post" };

/**
 * Ручная публикация из меню («Опубликовать сейчас (тест)»). Шлёт ПЕРВЫЙ пост дня —
 * быстрый тест. Игнорирует тумблер и дедуп (явное действие админа), прогресс не трогает.
 */
export async function publishNow(deps: PostingDeps): Promise<PublishNowResult> {
  const { prisma, api, logger } = deps;
  const channel = await getPostingChannel(prisma);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  if (channel.chatId === null) {
    return { ok: false, reason: "no_target" };
  }
  const { today, week } = resolveNow(channel);
  const posts = await getPostsForDay(prisma, channel.id, week, today.weekday);
  const first = posts[0];
  if (first === undefined) {
    return { ok: false, reason: "no_post" };
  }
  await safeSend(api, channel.chatId, buildPostMessage(first));
  logger.info({ channelId: channel.id, week }, "пост опубликован (вручную)");
  return { ok: true, week };
}
