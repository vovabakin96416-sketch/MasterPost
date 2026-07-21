import { type Api, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import {
  getDueOneOffPosts,
  getPostInteractive,
  getPostsForDay,
  getPostToPublish,
  markOneOffPublished,
  type DueOneOffPost,
  type PostToPublish,
} from "../db/repositories/postRepository.js";
import { buildPostKeyboard } from "./postButtons.js";
import {
  ensureCampaignStart,
  getOwnerTelegramIdByChannelId,
  getPostingChannelById,
  listPostingChannels,
  type PostingChannel,
} from "../db/repositories/channelRepository.js";
import { resolveOwnerTarget } from "../core/approval/access.js";
import { localDateParts } from "../core/schedule/localDate.js";
import { resolveCampaignDay } from "../core/schedule/resolveCampaignDay.js";
import { dueTimes } from "../core/schedule/times.js";
import { extractTriggerFromCta } from "../core/triggers/extractTriggerFromCta.js";
import { validateTriggerWord } from "../core/menu/validation.js";
import {
  addAiTriggerWord,
  getAiTriggerWords,
} from "./ai/aiReplySettings.js";
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
import { seedVariantMetric } from "../db/repositories/postMetricRepository.js";
import { resolvePhoto, refToCacheString } from "./mediaService.js";
import type { PhotoRef } from "../core/media/types.js";
import type { PhotoSources } from "../core/media/resolvePriority.js";
// 10c: AI-подхват автопостинга. Импорт «функция↔функция» с aiPostApprovalService
// циклический, но безопасный: обе стороны используются только внутри тел функций
// (не на верхнем уровне модуля), а объявления функций поднимаются (hoisting).
import { buildAiDraft, type AiDraftFailure } from "./ai/aiPostApprovalService.js";
import { routeChannel, sendVia } from "./botRouting.js";
import type { OwnerBotRegistry } from "./botRegistry.js";

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

/**
 * Зависимости публикации: БД, логгер, Telegram API, id супервладельца, ключ Pexels
 * (фото) и ключ Anthropic (10c: AI-подхват в автопостинге — генерим пост, если план
 * пуст). Шаг 14b-2: `adminId` — НЕ адресат превью/уведомлений, а фолбэк на случай
 * канала без владельца (адресат — владелец канала, `channelNotifyTarget`).
 */
export interface PostingDeps {
  prisma: PrismaClient;
  logger: Logger;
  api: Api;
  // Шаг 14b-bis-3: маршрутизация «каким ботом писать». `ownerBots` — реестр ботов
  // клиентов (пост канала уходит ботом ЕГО владельца), `fallbackApi` — общий бот,
  // которым повторяем отправку, если бот клиента не смог (нет прав, 403 в личке).
  // Оба опциональны: без них сервис работает ровно как до 14b-bis (один `api`).
  ownerBots?: OwnerBotRegistry | undefined;
  fallbackApi?: Api | undefined;
  adminId: number;
  pexelsApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  // Шаг 11b: таймаут вызова Claude (мс). undefined → DEFAULT_AI_TIMEOUT_MS.
  timeoutMs?: number | undefined;
}

/** Лимит подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

/** Собирает текст поста: `*title*` + текст + CTA (порт `send_post`). */
export function buildPostMessage(post: PostSnapshot): string {
  return `*${post.title}*\n\n${post.text}\n\n${post.cta}`.trim();
}

/** Источники фото поста (для `resolvePhoto`) из строки контент-плана. */
function photoSourcesOf(post: PostToPublish): {
  photoUrl: string | null;
  pexelsQuery: string | null;
  photoPath: string | null;
} {
  // photoFileId (своё загруженное фото, Шаг 6c) идёт как photoUrl — высший приоритет.
  return {
    photoUrl: post.photoFileId,
    pexelsQuery: post.pexelsQuery,
    photoPath: post.photoPath,
  };
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
 *
 * Возвращает `message_id` опубликованного сообщения (Шаг 13d — привязка варианта
 * эксперимента к будущему снимку метрик) или null, если отправить не удалось.
 */
export async function sendPost(
  deps: PostingDeps,
  chatId: string | number,
  text: string,
  photo: PhotoRef | null,
  keyboard?: InlineKeyboard,
): Promise<number | null> {
  // Шаг 14b-bis-3: отправляем ботом владельца канала, а если он не смог (не админ
  // в канале, отобрали права, не нажали /start) — повторяем общим ботом целиком,
  // вместе со всеми деградациями ниже. Пост важнее того, чьим именем он подписан.
  return sendVia(deps, (api) =>
    sendPostVia(api, deps.logger, chatId, text, photo, keyboard),
  );
}

async function sendPostVia(
  api: Api,
  logger: Logger,
  chatId: string | number,
  text: string,
  photo: PhotoRef | null,
  keyboard?: InlineKeyboard,
): Promise<number | null> {
  if (photo !== null) {
    const input = toInputPhoto(photo);
    const caption = truncateCaption(text);
    try {
      const msg = await api.sendPhoto(chatId, input, {
        caption,
        parse_mode: "Markdown",
        ...markup(keyboard),
      });
      return msg.message_id;
    } catch (err) {
      // Кривой Markdown — пробуем то же фото без разметки. Если и повтор упал (или
      // ошибка вовсе не про разметку — битый URL, нет файла) — НЕ роняем пост:
      // логируем и уходим в текстовую ветку ниже. Повтор тоже под try, иначе его
      // ошибка вылетит мимо фолбэка и «съест» пост/превью.
      if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
        try {
          const msg = await api.sendPhoto(chatId, input, { caption, ...markup(keyboard) });
          return msg.message_id;
        } catch (retryErr) {
          logger.warn({ err: retryErr }, "не смог отправить фото — публикую текстом");
        }
      } else {
        logger.warn({ err }, "не смог отправить фото — публикую текстом");
      }
    }
  }
  try {
    const msg = await api.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...markup(keyboard),
    });
    return msg.message_id;
  } catch (err) {
    if (err instanceof GrammyError && /pars|entit/i.test(err.description)) {
      const msg = await api.sendMessage(chatId, text, { ...markup(keyboard) });
      return msg.message_id;
    }
    throw err;
  }
}

/**
 * Шаг 11f: авто-регистрация AI-триггера из CTA опубликованного поста. Владелец
 * пишет «напишите СЛОВО в комментах» → бот сам добавляет слово в набор
 * `ai_trigger_words` (Шаг 11c), и стадия комментов отвечает голосом канала без
 * ручной сверки. 0 токенов — слово достаём эвристикой (`extractTriggerFromCta`).
 *
 * Идемпотентно и только добавляем (снятие «отжившего» триггера — в бэклоге):
 * `validateTriggerWord` отсекает нормализованные дубли, `addAiTriggerWord` не
 * плодит повторов. Свои ошибки глотаем — регистрация НЕ должна ронять публикацию.
 */
async function registerCtaTrigger(
  deps: PostingDeps,
  channelId: string,
  cta: string,
): Promise<void> {
  try {
    const candidate = extractTriggerFromCta(cta);
    if (candidate === null) {
      return;
    }
    const existing = await getAiTriggerWords(deps.prisma, channelId);
    const check = validateTriggerWord(candidate, existing);
    if (!check.ok) {
      return; // уже есть (нормализованный дубль) — ничего не делаем
    }
    await addAiTriggerWord(deps.prisma, channelId, check.value);
    deps.logger.info(
      { channelId, word: check.value },
      "AI-триггер авто-зарегистрирован из CTA поста (11f)",
    );
  } catch (err) {
    deps.logger.warn(
      { err, channelId },
      "не смог авто-зарегистрировать AI-триггер из CTA",
    );
  }
}

/**
 * Telegram-адресат уведомлений/превью канала (Шаг 14b-2): владелец канала, без
 * владельца — супервладелец. Сбой чтения не роняет вызвавшего: уведомление в этом
 * случае уходит супервладельцу (лучше не тому, чем никому).
 */
async function channelNotifyTarget(
  deps: PostingDeps,
  channelId: string,
): Promise<number> {
  try {
    const ownerTelegramId = await getOwnerTelegramIdByChannelId(deps.prisma, channelId);
    return resolveOwnerTarget(ownerTelegramId, deps.adminId);
  } catch (err) {
    deps.logger.warn(
      { err, channelId },
      "не смог определить владельца канала — уведомляю супервладельца",
    );
    return deps.adminId;
  }
}

/**
 * Уведомление владельцу канала простым текстом; ошибку доставки только логируем.
 * Шаг 14b-bis-3: маршрутизируем ЗДЕСЬ, а не у вызывающих, — уведомления шлются из
 * десятка мест, и лучше лишний запрос владельца, чем письмо не тем ботом.
 */
async function notifyChannelOwner(
  deps: PostingDeps,
  channelId: string,
  text: string,
): Promise<void> {
  const routed = await routeChannel(deps, channelId);
  try {
    const target = await channelNotifyTarget(routed, channelId);
    await sendVia(routed, (api) => api.sendMessage(target, text));
  } catch (err) {
    deps.logger.error({ err, channelId }, "не смог уведомить владельца канала");
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
  rawDeps: PostingDeps,
  channel: PostingChannel,
): Promise<void> {
  // Шаг 14b-bis-3: с этого места и до конца тика канал ведёт бот СВОЕГО владельца
  // (если подключён) — публикация, превью одобрения, уведомления.
  const deps = await routeChannel(rawDeps, channel.id);
  const { prisma, logger } = deps;
  const config = await readAutopostConfig(prisma, channel.id);
  if (!config.enabled) {
    return;
  }

  // Шаг 11a: якорим старт кампании при первом активном тике, иначе `resolveCampaignDay`
  // вечно отдаёт «неделю 1» и план стоит на месте. С этого момента недели идут по порядку.
  if (channel.campaignStart === null) {
    channel.campaignStart = await ensureCampaignStart(prisma, channel.id, new Date());
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
    await notifyChannelOwner(
      deps,
      channel.id,
      "⚠️ Автопостинг включён, но канал публикации не задан. Открой «📅 Автопостинг → 🎯 Канал публикации».",
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
        await registerCtaTrigger(deps, channel.id, post.cta);
        logger.info(
          { channelId: channel.id, week, day: today.weekday, time, idx },
          "пост опубликован (авто)",
        );
      } else if (post === undefined && config.aiEnabled) {
        // 10c: на слот нет готового поста, но включён AI-подхват — генерим пост
        // голосом канала. Одобрение подчиняется общему тумблеру (approvalOn).
        await placeAiFallbackPost(deps, channel, approvalOn, idx === 0);
      } else if (post === undefined && idx === 0) {
        await notifyChannelOwner(
          deps,
          channel.id,
          `⚠️ Нет постов на сегодня. Неделя ${String(week)}, день ${today.weekday}. Проверьте контент-план.`,
        );
        logger.warn({ week, day: today.weekday, time }, "нет постов на сегодня");
      } else {
        logger.info({ week, time, idx }, "постов на сегодня меньше, чем времён — пропуск");
      }
    } catch (err) {
      logger.error({ err, time }, "ошибка публикации");
    } finally {
      // Прогресс пишем после КАЖДОГО времени, а не одним куском после цикла:
      // рестарт/redeploy посреди цикла не должен повторно публиковать уже
      // отправленные посты следующим тиком.
      posted.push(time);
      await saveProgress(prisma, channel.id, {
        date: today.isoDate,
        postedTimes: posted,
      });
    }
  }
}

/** Сообщение админу, если AI-подхват не смог собрать пост (10c). */
function aiFallbackFailText(reason: AiDraftFailure, title: string): string {
  switch (reason) {
    case "no_key":
      return `⚠️ AI-подхват включён, но нет ANTHROPIC_API_KEY — пост для «${title}» не сгенерирован. Добавь ключ Anthropic в переменные Railway.`;
    case "no_samples":
      return `⚠️ AI-подхват: у канала «${title}» нет постов-образцов — заполни контент-план, чтобы AI перенял стиль.`;
    case "gen_failed":
      return `⚠️ AI-подхват: не удалось сгенерировать пост для «${title}» (модель не ответила). Попробую в следующий слот.`;
  }
}

/**
 * 10c: собирает AI-пост голосом канала и помещает его туда же, куда и плановый —
 * одобрение ВКЛ → в очередь на превью; ВЫКЛ → сразу в канал (цель гарантирована
 * guard'ом выше по коду). При неудаче генерации уведомляем админа один раз за день
 * (`notifyOnFail` = первый пустой слот), иначе только лог — чтобы не спамить.
 */
async function placeAiFallbackPost(
  deps: PostingDeps,
  channel: PostingChannel,
  approvalOn: boolean,
  notifyOnFail: boolean,
): Promise<void> {
  // Шаг 13c — вариант эксперимента назначаем только когда пост реально уходит в
  // очередь (одобрение ВКЛ): директива уйдёт в промпт, а `variantKey` сохранится в
  // `PendingPost`. Прямая публикация (одобрение ВЫКЛ) варианта не пишет — привязка
  // к `PostMetric` появится в 13d. `buildAiDraft` сам назначит вариант по флагу.
  const built = await buildAiDraft(deps, channel, { participateInExperiment: approvalOn });
  if (!built.ok) {
    deps.logger.warn(
      { channelId: channel.id, reason: built.reason },
      "AI-подхват автопостинга не удался",
    );
    if (notifyOnFail) {
      await notifyChannelOwner(deps, channel.id, aiFallbackFailText(built.reason, channel.title));
    }
    return;
  }
  if (approvalOn) {
    // `built.draft` уже несёт `variantKey` активного эксперимента (если он идёт).
    await requestApprovalForDraft(deps, channel.id, channel.chatId, built.draft);
    deps.logger.info(
      { channelId: channel.id },
      "AI-пост (автоподхват) отправлен на одобрение",
    );
    return;
  }
  // Одобрение ВЫКЛ → публикуем сразу. chatId здесь гарантированно задан.
  if (channel.chatId === null) {
    return;
  }
  const photo = await resolvePhoto(deps, channel.id, built.draft.photoSources);
  await sendPost(deps, channel.chatId, buildPostMessage(built.draft), photo);
  await registerCtaTrigger(deps, channel.id, built.draft.cta);
  deps.logger.info({ channelId: channel.id }, "AI-пост (автоподхват) опубликован");
}

// ─── Разовый пост вне расписания (Шаг 6c) ─────────────────────────────────────

/**
 * Публикует один разовый пост в его канал. Минует одобрение: админ уже видел
 * предпросмотр в мастере, а в момент X его может не быть на месте. Помечает пост
 * опубликованным ТОЛЬКО после успешной отправки (иначе следующий тик повторит).
 */
async function publishOneOffPost(
  rawDeps: PostingDeps,
  post: DueOneOffPost,
): Promise<void> {
  // Шаг 14b-bis-3: разовый пост тоже уходит ботом владельца канала.
  const deps = await routeChannel(rawDeps, post.channelId);
  const channel = await getPostingChannelById(deps.prisma, post.channelId);
  if (channel === null) {
    // Канал удалён — пост уже не доставить; помечаем, чтобы не зацикливаться.
    await markOneOffPublished(deps.prisma, post.channelId, post.externalId);
    deps.logger.warn(
      { channelId: post.channelId, externalId: post.externalId },
      "разовый пост: канал не найден — отмечен опубликованным без отправки",
    );
    return;
  }
  if (channel.chatId === null) {
    // Цель ещё не задана — НЕ помечаем, чтобы опубликовать, когда канал укажут.
    deps.logger.warn(
      { channelId: post.channelId, externalId: post.externalId },
      "разовый пост: канал публикации не задан — отложено",
    );
    return;
  }
  const photo = await resolvePhoto(deps, channel.id, photoSourcesOf(post));
  await sendPost(
    deps,
    channel.chatId,
    buildPostMessage(post),
    photo,
    postKeyboard(channel.id, post),
  );
  await markOneOffPublished(deps.prisma, post.channelId, post.externalId);
  await registerCtaTrigger(deps, channel.id, post.cta);
  deps.logger.info(
    { channelId: channel.id, externalId: post.externalId },
    "разовый пост опубликован",
  );
  await notifyChannelOwner(deps, channel.id, `✅ Разовый пост опубликован в ${channel.title}.`);
}

/**
 * Тик планировщика (Шаг 6c): публикует все разовые посты, которым настало время
 * (`publishAt <= now`, ещё не опубликованы). Ошибка одного поста изолирована и не
 * роняет остальные; об ошибке уведомляем админа.
 */
export async function publishDueOneOffPosts(deps: PostingDeps): Promise<void> {
  const due = await getDueOneOffPosts(deps.prisma, new Date());
  for (const post of due) {
    try {
      await publishOneOffPost(deps, post);
    } catch (err) {
      deps.logger.error(
        { err, channelId: post.channelId, externalId: post.externalId },
        "ошибка публикации разового поста",
      );
      await notifyChannelOwner(
        deps,
        post.channelId,
        `⚠️ Не удалось опубликовать разовый пост (#${String(post.externalId)}). Подробности в логах.`,
      );
    }
  }
}

// ─── Одобрение постов (Шаг 5) + фото-превью (Шаг 6a) ──────────────────────────

/** Ссылка на фото по кэш-строке очереди (`PendingPost.photoUrl`): URL или file_id. */
export function photoRefFromCache(photoUrl: string | null): PhotoRef | null {
  return photoUrl === null ? null : { kind: "url", url: photoUrl };
}

/**
 * Шлёт владельцу канала превью одобрения (с фото, если подобрано) с кнопками
 * (Шаг 14b-2: адресат — владелец, канал без владельца → супервладелец). Устойчив
 * к ошибкам доставки — превью не должно «ронять» тик планировщика/обработчик меню.
 */
export async function sendApprovalPreview(
  rawDeps: PostingDeps,
  channelId: string,
  caption: string,
  pendingId: string,
  photo: PhotoRef | null,
): Promise<void> {
  // Шаг 14b-bis-3: превью с кнопками шлём ботом владельца — тогда и решение
  // («✅ Опубликовать») он нажмёт в СВОЁМ боте, и публикация пойдёт оттуда же.
  const deps = await routeChannel(rawDeps, channelId);
  const target = await channelNotifyTarget(deps, channelId);
  const keyboard = approvalKeyboard(pendingId);
  try {
    await sendPost(deps, target, caption, photo, keyboard);
    return;
  } catch (err) {
    deps.logger.error({ err }, "не смог отправить превью одобрения — пробую простой текст");
  }
  // Последний фолбэк: без фото и без Markdown, чтобы кнопки одобрения точно дошли
  // (даже если виноваты битое фото и/или кривая разметка поста).
  try {
    await sendVia(deps, (api) =>
      api.sendMessage(target, caption, { reply_markup: keyboard }),
    );
  } catch (err) {
    deps.logger.error({ err }, "не смог отправить даже текстовое превью одобрения");
    await notifyChannelOwner(
      deps,
      channelId,
      `⚠️ Не удалось прислать пост на одобрение (id ${pendingId}). Открой «📋 Меню → Одобрение», найди пост в списке и нажми «👀 Прислать превью с кнопками».`,
    );
  }
}

/**
 * Обобщённый снимок для постановки в очередь одобрения (Шаг 10b). Не привязан к
 * посту контент-плана: обслуживает и плановый путь (`requestApproval`), и AI-пост
 * (`requestAiPostApproval`). `externalId` — исходный пост плана или `null` (иной
 * источник). `photoSources` — откуда брать фото (`resolvePhoto`); `pexelsQuery`
 * дополнительно кэшируется в очереди, чтобы «🔄 Другое фото» работало у AI-постов.
 */
export interface ApprovalDraft {
  readonly title: string;
  readonly text: string;
  readonly cta: string;
  readonly externalId: number | null;
  readonly pexelsQuery: string | null;
  readonly photoSources: PhotoSources;
  // Шаг 13b — вариант активного эксперимента (только AI-путь его проставляет).
  // Плановый пост не участвует в экспериментах → поле не задаётся (→ null в очереди).
  readonly variantKey?: string | null;
}

/**
 * Ставит произвольный снимок поста в очередь одобрения и шлёт владельцу канала
 * превью с кнопками (общий путь; порт `request_approval`). Шаг 6a: пред-загружаем фото одним
 * запросом к провайдеру и кэшируем в `PendingPost.photoUrl` — чтобы превью и
 * публикация взяли одну картинку. Шаг 10b: сюда сходятся плановый и AI-пост.
 */
export async function requestApprovalForDraft(
  deps: PostingDeps,
  channelId: string,
  target: string | null,
  draft: ApprovalDraft,
): Promise<void> {
  const photo = await resolvePhoto(deps, channelId, draft.photoSources);
  const pending = await createPending(deps.prisma, channelId, {
    title: draft.title,
    text: draft.text,
    cta: draft.cta,
    externalId: draft.externalId,
    photoUrl: refToCacheString(photo),
    pexelsQuery: draft.pexelsQuery,
    variantKey: draft.variantKey ?? null,
  });
  await sendApprovalPreview(
    deps,
    channelId,
    buildApprovalCaption(draft, target),
    pending.id,
    photo,
  );
}

/**
 * Плановый путь одобрения: снимок из поста контент-плана (Шаг 5/6a). Тонкая обёртка
 * над `requestApprovalForDraft` — поведение прежнее, теперь ещё кэширует `pexelsQuery`.
 */
export async function requestApproval(
  deps: PostingDeps,
  channelId: string,
  target: string | null,
  post: PostToPublish,
): Promise<void> {
  await requestApprovalForDraft(deps, channelId, target, {
    title: post.title,
    text: post.text,
    cta: post.cta,
    externalId: post.externalId,
    pexelsQuery: post.pexelsQuery,
    photoSources: photoSourcesOf(post),
  });
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
  rawDeps: PostingDeps,
  pendingId: string,
): Promise<PublishPendingResult> {
  const pending = await getPending(rawDeps.prisma, pendingId);
  if (pending === null) {
    return { ok: false, reason: "not_found" };
  }
  // Шаг 14b-bis-3: одобренный пост публикует бот владельца КАНАЛА поста (а не бот,
  // в котором нажали кнопку, — это может быть общий бот супервладельца).
  const deps = await routeChannel(rawDeps, pending.channelId);
  // Шаг 8b: одобренный пост уходит в СВОЙ канал (тот, для которого создан снимок),
  // а не в «первый активный» — иначе с двумя каналами публикация попадёт не туда.
  const channel = await getPostingChannelById(deps.prisma, pending.channelId);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  if (channel.chatId === null) {
    return { ok: false, reason: "no_target" };
  }
  const keyboard = await buildPendingPostKeyboard(deps, channel.id, pending.externalId);
  const messageId = await sendPost(
    deps,
    channel.chatId,
    buildPostMessage(pending),
    photoRefFromCache(pending.photoUrl),
    keyboard,
  );
  await deletePending(deps.prisma, pendingId);
  await registerCtaTrigger(deps, channel.id, pending.cta);
  // Шаг 13d: пост нёс вариант активного эксперимента → помечаем будущий снимок метрик
  // его ключом, чтобы вердикт (13a) считал по чистым выборкам. Best-effort: сбой пометки
  // не должен «отменять» уже опубликованный пост.
  if (pending.variantKey !== null && messageId !== null) {
    try {
      await seedVariantMetric(deps.prisma, channel.id, messageId, pending.variantKey);
    } catch (err) {
      deps.logger.warn(
        { err, channelId: channel.id, messageId },
        "не смог пометить опубликованный пост вариантом эксперимента",
      );
    }
  }
  deps.logger.info({ pendingId, channelId: channel.id }, "пост опубликован (одобрен)");
  return { ok: true };
}

/**
 * Реальная клавиатура поста из очереди (10c — вынесено из `publishPending`). Кнопки
 * берём из исходного поста контент-плана (у снимка их нет). Пост не из плана
 * (`externalId === null`, напр. AI-пост) — без кнопок.
 */
async function buildPendingPostKeyboard(
  deps: PostingDeps,
  channelId: string,
  externalId: number | null,
): Promise<InlineKeyboard | undefined> {
  if (externalId === null) {
    return undefined;
  }
  const interactive = await getPostInteractive(deps.prisma, channelId, externalId);
  return interactive === null
    ? undefined
    : buildPostKeyboard({
        channelId,
        externalId,
        interactiveType: interactive.interactiveType,
        choices: interactive.choices,
        button: interactive.button,
      });
}

/** Результат предпросмотра поста из очереди (10c). */
export type PendingPreviewResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/**
 * 10c: шлёт владельцу канала пост из очереди КАК В КАНАЛЕ — реальное фото, подпись
 * без «шапки одобрения» и настоящие кнопки поста. Отдельным сообщением: превью
 * одобрения с его кнопками остаётся на месте. Ничего не публикует и не трогает очередь.
 */
export async function sendPendingPreview(
  rawDeps: PostingDeps,
  pendingId: string,
): Promise<PendingPreviewResult> {
  const pending = await getPending(rawDeps.prisma, pendingId);
  if (pending === null) {
    return { ok: false, reason: "not_found" };
  }
  // Шаг 14b-bis-3: превью «как в канале» показываем тем же ботом, что и опубликует.
  const deps = await routeChannel(rawDeps, pending.channelId);
  const keyboard = await buildPendingPostKeyboard(
    deps,
    pending.channelId,
    pending.externalId,
  );
  await sendPost(
    deps,
    await channelNotifyTarget(deps, pending.channelId),
    buildPostMessage(pending),
    photoRefFromCache(pending.photoUrl),
    keyboard,
  );
  return { ok: true };
}

/**
 * Шлёт владельцу канала превью одобрения ЗАНОВО по id очереди (экран «📋 Одобрение» → карточка
 * поста). Нужен, когда исходное превью потерялось: раньше до такого поста нельзя было
 * добраться вообще, а счётчик очереди его считал.
 *
 * Кнопки решения живут на этом превью, а не на экране меню, намеренно: их обработчики
 * переписывают сообщение, на котором нажали (`editResolved`), — на экране меню это
 * стёрло бы навигацию и оставило админа в тупике.
 */
export async function resendApprovalPreview(
  deps: PostingDeps,
  pendingId: string,
): Promise<PendingPreviewResult> {
  const pending = await getPending(deps.prisma, pendingId);
  if (pending === null) {
    return { ok: false, reason: "not_found" };
  }
  const channel = await getPostingChannelById(deps.prisma, pending.channelId);
  await sendApprovalPreview(
    deps,
    pending.channelId,
    buildApprovalCaption(pending, channel?.chatId ?? null),
    pendingId,
    photoRefFromCache(pending.photoUrl),
  );
  return { ok: true };
}

/** Результат отправки тестового превью из меню. */
export type PreviewNowResult =
  | { ok: true }
  | { ok: false; reason: "no_channel" | "no_post" };

/**
 * Шлёт владельцу канала превью на одобрение для КОНКРЕТНОГО поста контент-плана ВЫБРАННОГО
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
