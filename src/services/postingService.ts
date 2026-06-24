import { type Api, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import {
  getPostForToday,
  type PostToPublish,
} from "../db/repositories/postRepository.js";
import {
  getPostingChannel,
  type PostingChannel,
} from "../db/repositories/channelRepository.js";
import { localDateParts } from "../core/schedule/localDate.js";
import { resolveCampaignDay } from "../core/schedule/resolveCampaignDay.js";
import { dueSlots, type SlotName } from "../core/schedule/dueSlots.js";
import { markSlotPosted, readAutopostConfig } from "./autopostSettings.js";

/**
 * Сервис публикации постов (Шаг 4 — порт `send_post` / `scheduled_*_post`).
 *
 * Изолирован от Telegram-слоя: принимает `bot.api` как зависимость, поэтому
 * вызывается и из планировщика (по расписанию), и из меню («Опубликовать сейчас»).
 * На Шаге 4 шлём только текст; фото (Шаги 5–6) и кнопки (Шаг 6) добавятся здесь же.
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
 * Тик планировщика: публикует слоты, которым «пора», в цель канала.
 * Дедуп по локальной дате: после попытки (публикация/предупреждение/пропуск)
 * слот помечается обработанным за сегодня, чтобы не сработать повторно.
 */
export async function publishDueSlots(deps: PostingDeps): Promise<void> {
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
  const due = dueSlots(today, config.times, config.last);
  if (due.length === 0) {
    return;
  }

  // Автопостинг включён, но цель не задана — один раз предупреждаем и помечаем,
  // чтобы не спамить каждую минуту.
  if (channel.chatId === null) {
    for (const slot of due) {
      await markSlotPosted(prisma, channel.id, slot, today.isoDate);
    }
    await notifyAdmin(
      deps,
      "⚠️ Автопостинг включён, но канал публикации не задан (chatId). Укажите его и включите снова.",
    );
    return;
  }

  for (const slot of due) {
    try {
      const post = await getPostForToday(prisma, channel.id, week, today.weekday, slot);
      if (post !== null) {
        await safeSend(api, channel.chatId, buildPostMessage(post));
        logger.info(
          { channelId: channel.id, week, day: today.weekday, slot },
          "пост опубликован (авто)",
        );
      } else if (slot === "morning") {
        await notifyAdmin(
          deps,
          `⚠️ Нет поста на сегодня (утро). Неделя ${String(week)}, день ${today.weekday}. Проверьте контент-план.`,
        );
        logger.warn({ week, day: today.weekday, slot }, "нет поста на сегодня");
      } else {
        logger.info({ week, day: today.weekday, slot }, "вечернего поста нет — пропуск");
      }
    } catch (err) {
      logger.error({ err, slot }, "ошибка публикации слота");
    } finally {
      await markSlotPosted(prisma, channel.id, slot, today.isoDate);
    }
  }
}

/** Результат ручной публикации (для тоста/экрана меню). */
export type PublishNowResult =
  | { ok: true; week: number }
  | { ok: false; reason: "no_channel" | "no_target" | "no_post" };

/**
 * Ручная публикация слота из меню («Опубликовать сейчас»). В отличие от тика —
 * игнорирует тумблер и дедуп (явное действие админа) и НЕ помечает слот постнутым.
 */
export async function publishNow(
  deps: PostingDeps,
  slot: SlotName,
): Promise<PublishNowResult> {
  const { prisma, api, logger } = deps;
  const channel = await getPostingChannel(prisma);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  if (channel.chatId === null) {
    return { ok: false, reason: "no_target" };
  }
  const { today, week } = resolveNow(channel);
  const post = await getPostForToday(prisma, channel.id, week, today.weekday, slot);
  if (post === null) {
    return { ok: false, reason: "no_post" };
  }
  await safeSend(api, channel.chatId, buildPostMessage(post));
  logger.info({ channelId: channel.id, week, slot }, "пост опубликован (вручную)");
  return { ok: true, week };
}
