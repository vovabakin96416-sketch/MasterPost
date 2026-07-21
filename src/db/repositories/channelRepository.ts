import type { PrismaClient } from "../client.js";
import {
  DISCUSSION_GROUP_SETTING,
  type RoutableChannel,
} from "../../core/comments/routeChannel.js";
import { setJsonSetting } from "./settingRepository.js";

/** Данные канала под upsert. Nullable-поля передаём явно (null, не undefined). */
/**
 * Метаданные канала для сида. `campaignStart` сюда НЕ входит намеренно: единственный
 * писатель старта — `ensureCampaignStart` (см. ниже). Иначе сид, у которого старт был
 * бы `null`, затирал бы уже зафиксированный старт при каждом прогоне.
 */
export interface ChannelSeed {
  title: string;
  username: string;
  chatId: string | null;
  niche: string;
  language: string;
  region: string | null;
  goal: string | null;
  toneOfVoice: string | null;
  timezone: string;
  triggerWords: string[];
  isActive: boolean;
}

/**
 * Идемпотентно создаёт/обновляет канал по уникальному username.
 * Возвращает id канала — он нужен как внешний ключ для постов и пулов.
 *
 * ⚠️ `campaignStart` не трогаем ни в `create`, ни в `update` — это РАНТАЙМ-состояние
 * (когда план реально стартовал), а не метаданные канала. Раньше сид гнал сюда
 * `campaignStart: null` через `update: data`, и каждый `npm run seed` сбрасывал старт →
 * `resolveCampaignDay` навсегда отдавал «неделю 1», а план крутил одни и те же посты.
 */
export async function upsertChannel(
  prisma: PrismaClient,
  data: ChannelSeed,
): Promise<string> {
  const channel = await prisma.channel.upsert({
    where: { username: data.username },
    create: data,
    update: data,
    select: { id: true },
  });
  return channel.id;
}

/** Канал в форме, нужной триггерам: id + слова-триггеры из конфига. */
export interface ActiveChannel {
  id: string;
  triggerWords: string[];
}

/**
 * Возвращает единственный активный канал (или `null`). На Шаге 2 бот ведёт один
 * канал, поэтому резолвим первый активный. Привязка комментариев к каналу по
 * chat-id — это мультиканальность (Шаг 8), сюда не тащим.
 */
export async function getActiveChannel(
  prisma: PrismaClient,
): Promise<ActiveChannel | null> {
  return prisma.channel.findFirst({
    where: { isActive: true },
    select: { id: true, triggerWords: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Все активные каналы в форме для маршрутизации комментов (Шаг 8c). Порядок
 * `createdAt asc` совпадает с одноканальным резолвом (`getActiveChannel`/`findFirst`),
 * поэтому `[0]` — это прежний фолбэк «первый активный канал».
 */
export async function getActiveRoutableChannels(
  prisma: PrismaClient,
): Promise<RoutableChannel[]> {
  return prisma.channel.findMany({
    where: { isActive: true },
    select: { id: true, username: true, chatId: true, triggerWords: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Возвращает id активного канала, к которому привязана группа обсуждения `groupId`
 * (выученная связь, Шаг 8c), или `null`. Связь хранится в `Setting`
 * (`discussion_chat_id`), фильтр по активности — через relation-условие.
 */
export async function findChannelIdByDiscussionGroup(
  prisma: PrismaClient,
  groupId: string,
): Promise<string | null> {
  const row = await prisma.setting.findFirst({
    where: {
      key: DISCUSSION_GROUP_SETTING,
      value: { equals: groupId },
      channel: { isActive: true },
    },
    select: { channelId: true },
  });
  return row?.channelId ?? null;
}

/**
 * Запоминает связь «группа обсуждения → канал» (Шаг 8c). Идемпотентно: upsert
 * `Setting(channelId, discussion_chat_id)`. Авто-обучение из триггер-стадии, когда
 * канал коммента определён по `sender_chat` автопересланного поста.
 */
export async function setDiscussionGroup(
  prisma: PrismaClient,
  channelId: string,
  groupId: string,
): Promise<void> {
  await setJsonSetting(prisma, channelId, DISCUSSION_GROUP_SETTING, groupId);
}

/** Задаёт цель публикации автопостинга (@username или числовой id). Доработка 4.1. */
export async function setChatId(
  prisma: PrismaClient,
  channelId: string,
  chatId: string | null,
): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: { chatId },
  });
}

/**
 * Якорит старт контент-плана (Шаг 11a). Если `campaignStart` ещё не задан — ставит
 * его = `date`; если уже задан — НЕ трогает. Возвращает эффективный старт (существующий
 * или только что выставленный), либо `null`, если канала нет. Идемпотентно.
 *
 * Зачем: без старта `resolveCampaignDay` всегда отдаёт «неделю 1» → план стоит на месте
 * и каждую неделю крутит те же посты. Первый запуск автопостинга/тик планировщика
 * фиксирует старт = сегодня, и недели начинают идти по порядку 1→2→3→4.
 */
export async function ensureCampaignStart(
  prisma: PrismaClient,
  channelId: string,
  date: Date,
): Promise<Date | null> {
  const row = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { campaignStart: true },
  });
  if (row === null) {
    return null;
  }
  if (row.campaignStart !== null) {
    return row.campaignStart;
  }
  await prisma.channel.update({
    where: { id: channelId },
    data: { campaignStart: date },
  });
  return date;
}

/** Канал в форме, нужной автопостингу (Шаг 4): цель + пояс + старт кампании. */
export interface PostingChannel {
  id: string;
  chatId: string | null;
  timezone: string;
  campaignStart: Date | null;
  title: string;
  username: string | null;
}

/**
 * Возвращает единственный активный канал для автопостинга/планировщика (или `null`).
 * Отдаёт цель публикации (`chatId`), пояс и старт кампании — всё, что нужно, чтобы
 * посчитать «пост на сегодня» и отправить его. На Шаге 4 канал один (как и триггеры).
 */
export async function getPostingChannel(
  prisma: PrismaClient,
): Promise<PostingChannel | null> {
  return prisma.channel.findFirst({
    where: { isActive: true },
    select: {
      id: true,
      chatId: true,
      timezone: true,
      campaignStart: true,
      title: true,
      username: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Все активные каналы для планировщика автопостинга (Шаг 8b). Та же форма и тот же
 * `select`, что у `getPostingChannel`, но списком — планировщик обходит каждый. Порядок
 * `createdAt asc` совпадает с одноканальным резолвом (`findFirst`): канал №1 идёт первым.
 */
export async function listPostingChannels(
  prisma: PrismaClient,
): Promise<PostingChannel[]> {
  return prisma.channel.findMany({
    where: { isActive: true },
    select: {
      id: true,
      chatId: true,
      timezone: true,
      campaignStart: true,
      title: true,
      username: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Канал по id в форме для триггеров/разделов меню (Шаг 8a). */
export async function getChannelById(
  prisma: PrismaClient,
  id: string,
): Promise<ActiveChannel | null> {
  return prisma.channel.findUnique({
    where: { id },
    select: { id: true, triggerWords: true },
  });
}

/** Канал по id в форме для автопостинга/аналитики (Шаг 8a). */
export async function getPostingChannelById(
  prisma: PrismaClient,
  id: string,
): Promise<PostingChannel | null> {
  return prisma.channel.findUnique({
    where: { id },
    select: {
      id: true,
      chatId: true,
      timezone: true,
      campaignStart: true,
      title: true,
      username: true,
    },
  });
}

/** Канал в форме для AI-ответа в комментах (Шаг 11c): тон/ниша/язык/TZ. */
export interface ReplyChannel {
  id: string;
  title: string;
  niche: string;
  toneOfVoice: string | null;
  language: string;
  timezone: string;
}

/**
 * Канал по id с полями голоса канала для AI-ответа (Шаг 11c). Роутинг коммента даёт
 * только `RoutableChannel` (id/username/chatId/triggerWords) — эти поля фетчим ленивно,
 * только когда AI-триггер уже совпал (экономим запрос на обычных комментах).
 */
export async function getReplyChannelById(
  prisma: PrismaClient,
  id: string,
): Promise<ReplyChannel | null> {
  return prisma.channel.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      niche: true,
      toneOfVoice: true,
      language: true,
      timezone: true,
    },
  });
}

/** Сводка канала для списка «📡 Каналы» в меню (Шаг 8a). */
export interface ChannelListItem {
  id: string;
  title: string;
  username: string | null;
  chatId: string | null;
  niche: string;
  isActive: boolean;
}

/**
 * Все каналы владельца для переключателя в /menu (Шаг 8a). Порядок — `createdAt asc`,
 * тот же, что у одноканального резолва рантайма (`findFirst`), поэтому «первый» канал
 * совпадает с тем, что ведёт автопостинг/триггеры до подшагов 8b/8c.
 */
export async function listChannels(
  prisma: PrismaClient,
): Promise<ChannelListItem[]> {
  return prisma.channel.findMany({
    select: {
      id: true,
      title: true,
      username: true,
      chatId: true,
      niche: true,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Каналы КОНКРЕТНОГО владельца (Шаг 14a) — та же форма и порядок, что у `listChannels`,
 * плюс фильтр по `ownerId`. С 14b-1 на ней стоит переключатель каналов меню
 * (`resolveChannelMenu`) — каждый владелец видит только своё. `listChannels`
 * (все каналы) остаётся для служебных скриптов (`backfill-campaign-start`).
 */
export async function listChannelsByOwner(
  prisma: PrismaClient,
  ownerId: string,
): Promise<ChannelListItem[]> {
  return prisma.channel.findMany({
    where: { ownerId },
    select: {
      id: true,
      title: true,
      username: true,
      chatId: true,
      niche: true,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Создаёт ПУСТОЙ канал (без контент-плана/пулов) для мультиканальности (Шаг 8a).
 * Минимум полей: название + владелец (Шаг 14b-1 — «➕ Добавить канал» штампует
 * `ownerId`, канал сразу виден в скоупленном меню) + ниша-заглушка; остальное —
 * дефолты схемы (язык ru, пояс Europe/Moscow, isActive, пустые triggerWords).
 * Отдельно от `upsertChannel` (тот по username, для сида). Возвращает id нового канала.
 */
export async function createChannel(
  prisma: PrismaClient,
  data: { title: string; ownerId: string },
): Promise<string> {
  const channel = await prisma.channel.create({
    data: { title: data.title, ownerId: data.ownerId, niche: "—" },
    select: { id: true },
  });
  return channel.id;
}

/** Возвращает id первого канала с такой целью публикации `chatId`, или `null` (Шаг 9a). */
export async function findChannelByChatId(
  prisma: PrismaClient,
  chatId: string,
): Promise<string | null> {
  const row = await prisma.channel.findFirst({
    where: { chatId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return row?.id ?? null;
}

/** Результат онбординга канала: id + был ли создан новый (для текста владельцу). */
export interface OnboardingResult {
  id: string;
  created: boolean;
}

/**
 * Регистрирует/линкует канал по факту добавления бота админом (Шаг 9a, онбординг).
 * Идемпотентно: сначала ищет канал по `username` (поле `@unique` — совпадёт с сид-каналом),
 * затем по `chatId`; если нашёл — обновляет цель публикации/идентификаторы/название и
 * включает его; иначе создаёт новый (ниша-заглушка «—», как `createChannel`). Возвращает
 * id и флаг `created`.
 *
 * Владелец (Шаг 14b-1): новый канал штампуется `ownerId` подключившего; у существующего
 * владелец ставится ТОЛЬКО если его ещё нет (`ownerId IS NULL`) — переподключение бота
 * другим владельцем чужой канал не перехватывает (передача канала — руками супервладельца).
 */
export async function registerChannelFromOnboarding(
  prisma: PrismaClient,
  data: { chatId: string; username: string | null; title: string; ownerId: string },
): Promise<OnboardingResult> {
  let existing: { id: string; ownerId: string | null } | null = null;
  if (data.username !== null) {
    existing = await prisma.channel.findUnique({
      where: { username: data.username },
      select: { id: true, ownerId: true },
    });
  }
  if (existing === null) {
    existing = await prisma.channel.findFirst({
      where: { chatId: data.chatId },
      select: { id: true, ownerId: true },
      orderBy: { createdAt: "asc" },
    });
  }

  if (existing !== null) {
    await prisma.channel.update({
      where: { id: existing.id },
      data: {
        chatId: data.chatId,
        username: data.username,
        title: data.title,
        isActive: true,
        ownerId: existing.ownerId ?? data.ownerId,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.channel.create({
    data: {
      title: data.title,
      username: data.username,
      chatId: data.chatId,
      ownerId: data.ownerId,
      niche: "—",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Telegram user id владельца канала с целью публикации `chatId`, или `null`
 * (канал не зарегистрирован либо без владельца). Шаг 14b-1: уведомления онбординга
 * (бота разжаловали/убрали из канала) идут владельцу КАНАЛА, а не супервладельцу.
 */
export async function getOwnerTelegramIdByChatId(
  prisma: PrismaClient,
  chatId: string,
): Promise<string | null> {
  const row = await prisma.channel.findFirst({
    where: { chatId },
    select: { owner: { select: { telegramUserId: true } } },
    orderBy: { createdAt: "asc" },
  });
  return row?.owner?.telegramUserId ?? null;
}

/**
 * Telegram user id владельца канала по id канала, или `null` (канал не найден
 * либо без владельца). Шаг 14b-2: превью одобрения и служебные уведомления
 * рантайма (нет постов, AI-подхват упал, разовый пост и т.п.) идут владельцу
 * КАНАЛА; без владельца адресат — супервладелец (`resolveOwnerTarget`).
 */
export async function getOwnerTelegramIdByChannelId(
  prisma: PrismaClient,
  channelId: string,
): Promise<string | null> {
  const row = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { owner: { select: { telegramUserId: true } } },
  });
  return row?.owner?.telegramUserId ?? null;
}

/**
 * id строки `Owner` по id канала, или `null` (канал не найден либо без владельца).
 * Шаг 14b-bis-3: по нему маршрутизация находит бота владельца в реестре — публикация
 * и служебные DM канала идут ЕГО ботом, а не общим.
 */
export async function getOwnerIdByChannelId(
  prisma: PrismaClient,
  channelId: string,
): Promise<string | null> {
  const row = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { ownerId: true },
  });
  return row?.ownerId ?? null;
}

/** Включает/выключает канал (Шаг 8a). Неактивный канал рантайм не ведёт. */
export async function setChannelActive(
  prisma: PrismaClient,
  id: string,
  isActive: boolean,
): Promise<void> {
  await prisma.channel.update({ where: { id }, data: { isActive } });
}

/** Отображаемые данные канала для экрана «Сводка» (бывш. «Статус»). */
export interface ChannelDisplay {
  title: string;
  username: string | null;
}

/** Возвращает заголовок/username канала для экрана статуса (Шаг 3) или `null`. */
export async function getChannelDisplay(
  prisma: PrismaClient,
  channelId: string,
): Promise<ChannelDisplay | null> {
  return prisma.channel.findUnique({
    where: { id: channelId },
    select: { title: true, username: true },
  });
}

/**
 * Добавляет слово-триггер и создаёт пустой пул ответов под него (Шаг 3, меню админа).
 * Атомарно (одна транзакция): слово в `Channel.triggerWords` + строка `TextPool`
 * с ключом-словом. Идемпотентно — повтор не плодит дублей и не затирает ответы.
 */
export async function addTrigger(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      select: { triggerWords: true },
    });
    if (channel === null) {
      return;
    }
    if (!channel.triggerWords.includes(word)) {
      await tx.channel.update({
        where: { id: channelId },
        data: { triggerWords: { set: [...channel.triggerWords, word] } },
      });
    }
    // Пул создаём только если его ещё нет; существующие ответы не трогаем.
    await tx.textPool.upsert({
      where: { channelId_key: { channelId, key: word } },
      create: { channelId, key: word, texts: [] },
      update: {},
    });
  });
}

/**
 * Удаляет слово-триггер вместе с его пулом ответов (Шаг 3). Атомарно: убираем
 * слово из `Channel.triggerWords` и удаляем строку `TextPool` (если есть).
 */
export async function removeTrigger(
  prisma: PrismaClient,
  channelId: string,
  word: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      select: { triggerWords: true },
    });
    if (channel !== null && channel.triggerWords.includes(word)) {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          triggerWords: {
            set: channel.triggerWords.filter((w) => w !== word),
          },
        },
      });
    }
    await tx.textPool.deleteMany({ where: { channelId, key: word } });
  });
}
