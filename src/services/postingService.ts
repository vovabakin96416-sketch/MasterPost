import { type Api, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import {
  getPostInteractive,
  getPostsForDay,
  getPostToPublish,
  type PostToPublish,
} from "../db/repositories/postRepository.js";
import { buildPostKeyboard } from "./postButtons.js";
import {
  getPostingChannelById,
  listPostingChannels,
  type PostingChannel,
} from "../db/repositories/channelRepository.js";
import { localDateParts } from "../core/schedule/localDate.js";
import { resolveCampaignDay } from "../core/schedule/resolveCampaignDay.js";
import { dueTimes } from "../core/schedule/times.js";
import { readAutopostConfig, saveProgress } from "./autopostSettings.js";
import {
  approvalKeyboard,
  buildApprovalCaption,
  isApprovalEnabled,
  type PostSnapshot,
} from "./approvalService.js";
import {
  createPending,
  deletePending,
  getPending,
} from "../db/repositories/pendingPostRepository.js";
import { resolvePhoto, refToCacheString } from "./mediaService.js";
import type { PhotoRef } from "../core/media/types.js";

/**
 * Сервис публикации постов (Шаг 4 / Доработка 4.1 / Шаг 6a — порт `send_post`).
 *
 * Изолирован от Telegram-слоя: принимает `bot.api` как зависимость, поэтому
 * вызывается и из планировщика (по расписанию), и из меню («Опубликовать сейчас»).
 * Шаг 6a: посты уходят с фото (если подобрано); кнопки на постах — Шаг 6b.
 *
 * Расписание — произвольный список времён: посты дня (по их `time`) публикуются по
 * порядку в заданные времена. Индекс поста = число уже опубликованных сегодня.
 */

/** Зависимости публикации: БД, логгер, Telegram API, id админа и ключ Pexels (фото). */
export interface PostingDeps {
  prisma: PrismaClient;
  logger: Logger;
  api: Api;
  adminId: number;
  pexelsApiKey: string | undefined;
}

/** Лимит подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

/** Собирает текст поста: `*title*` + текст + CTA (порт `send_post`). */
export function buildPostMessage(post: PostSnapshot): string {
  return `*${post.title}*\n\n${post.text}\n\n${post.cta}`.trim();
}

/** Источники фото поста (для `resolvePhoto`) из строки контент-плана. */
function photoSourcesOf(post: PostToPublish): {
  pexelsQuery: string | null;
  photoPath: string | null;
} {
  return { pexelsQuery: post.pexelsQuery, photoPath: post.photoPath };
}

/** Клавиатура кнопок поста (Шаг 6b) из его интерактива; `undefined` — без кнопок. */
function postKeyboard(channelId: string, post: PostToPublish): InlineKeyboard | undefined {
  return buildPostKeyboard({
    channelId,
    externalId: post.externalId,
    interactiveType: post.interactiveType,
    choices: post.choices,
    button: post.button,
  });
}

/** Обрезает подпись под лимит Telegram (порт `[:1020]` Python-бота). */
function truncateCaption(text: string): string {
  return text.length <= CAPTION_LIMIT ? text : `${text.slice(0, CAPTION_LIMIT - 1)}…`;
}

/** Преобразует ссылку на фото к входу grammY (`url`/`file_id` — строка, путь — `InputFile`). */
function toInputPhoto(ref: PhotoRef): string | InputFile {
  switch (ref.kind) {
    case "url":
      return ref.url;
    case "fileId":
      return ref.fileId;
    case "path":
      return new InputFile(ref.path);
  }
}

/** Опции `reply_markup` без передачи `undefined` (exactOptionalPropertyTypes). */
function markup(keyboard: InlineKeyboard | undefined): { reply_markup?: InlineKeyboard } {
  return keyboard === undefined ? {} : { reply_markup: keyboard };
}

/**
 * Отправляет пост: с фото (`sendPhoto` + подпись) или текстом (`sendMessage`).
 * Расширение порта `safe_send`: при кривом Markdown — повтор без `parse_mode`; если
 * фото не уходит (битый URL и т.п.) — публикуем текстом, чтобы пост не пропал.
 */
export async function sendPost(
  deps: PostingDeps,
  chatId: string | number,
  text: string,
  photo: PhotoRef | null,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const { api, logger } = deps;
  if (photo !== null) {
    const input = toInputPhoto(photo);
    const caption = truncateCaption(text);
    try {
      await api.sendPhoto(chatId, input, {
        caption,
        parse_mode: "Markdown",
        ...markup(keyboard),
      });
      return;
    } catch (err) {
      // Кривой Markdown — пробуем то же фото без разметки. Если и повтор упал (или
      // ошибка вовсе не про разметку — битый URL, нет файла) — НЕ роняем пост:
      // логируем и уходим в текстовую ветку ниже. Повтор тоже под try, иначе его
      // ошибка вылетит мимо фолбэка и «съест» пост/превью.
      if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
        try {
          await api.sendPhoto(chatId, input, { caption, ...markup(keyboard) });
          return;
        } catch (retryErr) {
          logger.warn({ err: retryErr }, "не смог отправить фото — публикую текстом");
        }
      } else {
        logger.warn({ err }, "не смог отправить фото — публикую текстом");
      }
    }
  }
  try {
    await api.sendMessage(chatId, text, { parse_mode: "Markdown", ...markup(keyboard) });
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      await api.sendMessage(chatId, text, { ...markup(keyboard) });
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
 * Тик планировщика (Шаг 8b): обходит ВСЕ активные каналы и публикует посты в каждый.
 * Ошибка одного канала изолирована (try/catch) — не роняет публикацию остальных.
 */
export async function publishDuePosts(deps: PostingDeps): Promise<void> {
  const channels = await listPostingChannels(deps.prisma);
  for (const channel of channels) {
    try {
      await publishDuePostsForChannel(deps, channel);
    } catch (err) {
      deps.logger.error({ err, channelId: channel.id }, "ошибка автопостинга канала");
    }
  }
}

/**
 * Публикует посты дня одного канала в наступившие времена. Дедуп по локальной
 * дате (прогресс `{date, postedTimes}`): время отрабатывается раз в день, после
 * простоя — догоняет. Индекс поста = число уже опубликованных сегодня.
 */
export async function publishDuePostsForChannel(
  deps: PostingDeps,
  channel: PostingChannel,
): Promise<void> {
  const { prisma, logger } = deps;
  const config = await readAutopostConfig(prisma, channel.id);
  if (!config.enabled) {
    return;
  }

  const { today, week } = resolveNow(channel);
  const due = dueTimes(today, config.times, config.progress);
  if (due.length === 0) {
    return;
  }

  // С одобрением пост уходит не в канал, а админу на превью — цель проверяем
  // позже, при «✅ Опубликовать». Без одобрения цель нужна сразу.
  const approvalOn = await isApprovalEnabled(prisma, channel.id);

  // Уже отработанные сегодня времена (для продолжения нумерации постов в течение дня).
  const posted =
    config.progress.date === today.isoDate ? [...config.progress.postedTimes] : [];

  // Прямая публикация включена, но цель не задана — один раз предупреждаем и помечаем.
  if (!approvalOn && channel.chatId === null) {
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
      if (post !== undefined && approvalOn) {
        await requestApproval(deps, channel.id, channel.chatId, post);
        logger.info(
          { channelId: channel.id, week, day: today.weekday, time, idx },
          "пост отправлен на одобрение",
        );
      } else if (post !== undefined && channel.chatId !== null) {
        const photo = await resolvePhoto(deps, channel.id, photoSourcesOf(post));
        await sendPost(
          deps,
          channel.chatId,
          buildPostMessage(post),
          photo,
          postKeyboard(channel.id, post),
        );
        logger.info(
          { channelId: channel.id, week, day: today.weekday, time, idx },
          "пост опубликован (авто)",
        );
      } else if (post === undefined && idx === 0) {
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

// ─── Одобрение постов (Шаг 5) + фото-превью (Шаг 6a) ──────────────────────────

/** Ссылка на фото по кэш-строке очереди (`PendingPost.photoUrl`): URL или file_id. */
export function photoRefFromCache(photoUrl: string | null): PhotoRef | null {
  return photoUrl === null ? null : { kind: "url", url: photoUrl };
}

/**
 * Шлёт админу превью одобрения (с фото, если подобрано) с кнопками. Устойчив к
 * ошибкам доставки — превью не должно «ронять» тик планировщика/обработчик меню.
 */
export async function sendApprovalPreview(
  deps: PostingDeps,
  caption: string,
  pendingId: string,
  photo: PhotoRef | null,
): Promise<void> {
  const keyboard = approvalKeyboard(pendingId);
  try {
    await sendPost(deps, deps.adminId, caption, photo, keyboard);
    return;
  } catch (err) {
    deps.logger.error({ err }, "не смог отправить превью одобрения — пробую простой текст");
  }
  // Последний фолбэк: без фото и без Markdown, чтобы кнопки одобрения точно дошли
  // (даже если виноваты битое фото и/или кривая разметка поста).
  try {
    await deps.api.sendMessage(deps.adminId, caption, { reply_markup: keyboard });
  } catch (err) {
    deps.logger.error({ err }, "не смог отправить даже текстовое превью одобрения");
    await notifyAdmin(
      deps,
      `⚠️ Не удалось прислать пост на одобрение (id ${pendingId}). Откройте «📋 Меню → Одобрение постов» и нажмите на посте «👀 Прислать на тест».`,
    );
  }
}

/**
 * Ставит пост в очередь одобрения и шлёт админу превью с кнопками (порт
 * `request_approval`). Шаг 6a: пред-загружаем фото одним запросом к провайдеру и
 * кэшируем в `PendingPost.photoUrl` — чтобы превью и публикация взяли одну картинку.
 */
export async function requestApproval(
  deps: PostingDeps,
  channelId: string,
  target: string | null,
  post: PostToPublish,
): Promise<void> {
  const photo = await resolvePhoto(deps, channelId, photoSourcesOf(post));
  const pending = await createPending(deps.prisma, channelId, {
    title: post.title,
    text: post.text,
    cta: post.cta,
    externalId: post.externalId,
    photoUrl: refToCacheString(photo),
  });
  await sendApprovalPreview(deps, buildApprovalCaption(post, target), pending.id, photo);
}

/** Результат публикации одобренного поста (для тоста композера). */
export type PublishPendingResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_channel" | "no_target" };

/**
 * Публикует одобренный пост из очереди в канал и убирает его из очереди (порт
 * ветки `approve` в `approval_callback`). Цель проверяем здесь — на момент
 * одобрения, а не постановки в очередь.
 */
export async function publishPending(
  deps: PostingDeps,
  pendingId: string,
): Promise<PublishPendingResult> {
  const pending = await getPending(deps.prisma, pendingId);
  if (pending === null) {
    return { ok: false, reason: "not_found" };
  }
  // Шаг 8b: одобренный пост уходит в СВОЙ канал (тот, для которого создан снимок),
  // а не в «первый активный» — иначе с двумя каналами публикация попадёт не туда.
  const channel = await getPostingChannelById(deps.prisma, pending.channelId);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  if (channel.chatId === null) {
    return { ok: false, reason: "no_target" };
  }
  // Кнопки берём из исходного поста контент-плана (у снимка их нет). Если пост
  // создан не из плана (externalId === null) — публикуем без кнопок.
  const interactive =
    pending.externalId === null
      ? null
      : await getPostInteractive(deps.prisma, channel.id, pending.externalId);
  const keyboard =
    interactive === null
      ? undefined
      : buildPostKeyboard({
          channelId: channel.id,
          externalId: pending.externalId ?? 0,
          interactiveType: interactive.interactiveType,
          choices: interactive.choices,
          button: interactive.button,
        });
  await sendPost(
    deps,
    channel.chatId,
    buildPostMessage(pending),
    photoRefFromCache(pending.photoUrl),
    keyboard,
  );
  await deletePending(deps.prisma, pendingId);
  deps.logger.info({ pendingId, channelId: channel.id }, "пост опубликован (одобрен)");
  return { ok: true };
}

/** Результат отправки тестового превью из меню. */
export type PreviewNowResult =
  | { ok: true }
  | { ok: false; reason: "no_channel" | "no_post" };

/**
 * Шлёт админу превью на одобрение для КОНКРЕТНОГО поста контент-плана ВЫБРАННОГО
 * канала (Шаг 8b; кнопка «👀 Прислать на тест» в экране поста). Не зависит от
 * тумблера одобрения. `no_post` = пост не найден (возможно, удалён).
 */
export async function requestApprovalForPost(
  deps: PostingDeps,
  channelId: string,
  externalId: number,
): Promise<PreviewNowResult> {
  const channel = await getPostingChannelById(deps.prisma, channelId);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  const post = await getPostToPublish(deps.prisma, channel.id, externalId);
  if (post === null) {
    return { ok: false, reason: "no_post" };
  }
  await requestApproval(deps, channel.id, channel.chatId, post);
  return { ok: true };
}
