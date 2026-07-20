import { type Api, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import {
  getOwnerTelegramIdByChannelId,
  getPostingChannel,
  type PostingChannel,
} from "../db/repositories/channelRepository.js";
import { resolveOwnerTarget } from "../core/approval/access.js";
import { localDateParts } from "../core/schedule/localDate.js";
import { resolveCampaignDay } from "../core/schedule/resolveCampaignDay.js";
import { shouldWarnContentEnding } from "../core/analytics/contentEnding.js";

/**
 * Сервис аналитики канала (Шаг 7a — порт части `analytics.py`). Пока умеет одно:
 * напоминать владельцу, что контент-план дошёл до последней недели и скоро пойдёт
 * по кругу. Еженедельный отчёт по просмотрам (через MTProto/GramJS) — подшаги 7b/7c.
 *
 * Изолирован от Telegram-слоя: принимает `bot.api` зависимостью, поэтому вызывается
 * и из планировщика (по расписанию), и из меню («прислать сейчас»).
 */

/**
 * Зависимости аналитики: БД, логгер, Telegram API, адресат по умолчанию.
 * Шаг 14b-2: `adminId` — фолбэк (канал без владельца / глобальные сообщения);
 * канальные уведомления адресуются владельцу канала (`ownerTargetOf`).
 */
export interface AnalyticsDeps {
  prisma: PrismaClient;
  logger: Logger;
  api: Api;
  adminId: number;
}

/** Текст напоминания о конце контента (порт сообщения `check_content_ending`). */
const CONTENT_ENDING_TEXT = [
  "⚠️ *Пора готовить посты на новый месяц!*",
  "",
  "Сейчас идёт *неделя 4* — последняя в контент-плане.",
  "После неё цикл начнётся заново с недели 1 (посты повторятся).",
  "",
  "Обнови контент через «📅 План → 🗂 Весь план» в /menu или пере-сидом.",
].join("\n");

/** Считает текущую неделю кампании канала (по его поясу) — как в postingService. */
export function campaignWeekOf(
  channel: PostingChannel,
  now: Date = new Date(),
): number {
  const today = localDateParts(now, channel.timezone);
  const start =
    channel.campaignStart === null
      ? null
      : localDateParts(channel.campaignStart, channel.timezone);
  return resolveCampaignDay(today, start).week;
}

/** Отправляет пользователю текст с откатом Markdown; ошибку доставки только логируем. */
export async function sendToUser(
  deps: AnalyticsDeps,
  userId: number,
  text: string,
): Promise<void> {
  try {
    await deps.api.sendMessage(userId, text, { parse_mode: "Markdown" });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await deps.api.sendMessage(userId, text);
      return;
    }
    deps.logger.error({ err }, "не смог отправить напоминание владельцу");
  }
}

/** Отправляет адресату по умолчанию (`deps.adminId`) — для неканальных сообщений. */
export async function sendToAdmin(deps: AnalyticsDeps, text: string): Promise<void> {
  await sendToUser(deps, deps.adminId, text);
}

/**
 * Telegram-адресат уведомлений канала (Шаг 14b-2): владелец канала, без владельца —
 * `deps.adminId`. Сбой чтения не роняет вызвавшего — уйдёт адресату по умолчанию.
 */
export async function ownerTargetOf(
  deps: AnalyticsDeps,
  channelId: string,
): Promise<number> {
  try {
    const ownerTelegramId = await getOwnerTelegramIdByChannelId(deps.prisma, channelId);
    return resolveOwnerTarget(ownerTelegramId, deps.adminId);
  } catch (err) {
    deps.logger.warn(
      { err, channelId },
      "не смог определить владельца канала — уведомляю адресата по умолчанию",
    );
    return deps.adminId;
  }
}

/**
 * Тик планировщика (ВС 21:00 МСК): если идёт последняя неделя плана — напомнить
 * владельца КАНАЛА залить новый месяц контента. Иначе — тихо. Порт `check_content_ending`.
 */
export async function runContentEndingCheck(deps: AnalyticsDeps): Promise<void> {
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null) {
    return;
  }
  if (shouldWarnContentEnding(campaignWeekOf(channel))) {
    await sendToUser(deps, await ownerTargetOf(deps, channel.id), CONTENT_ENDING_TEXT);
    deps.logger.info("отправлено напоминание о конце контента");
  }
}

/** Принудительная отправка напоминания (тест-кнопка в меню), вне зависимости от недели. */
export async function sendContentEndingNotice(deps: AnalyticsDeps): Promise<void> {
  await sendToAdmin(deps, CONTENT_ENDING_TEXT);
}
