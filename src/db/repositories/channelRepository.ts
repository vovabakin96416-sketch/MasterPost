import type { PrismaClient } from "../client.js";
import {
  DISCUSSION_GROUP_SETTING,
  type RoutableChannel,
} from "../../core/comments/routeChannel.js";
import { setJsonSetting } from "./settingRepository.js";

/** Данные канала под upsert. Nullable-поля передаём явно (null, не undefined). */
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
  campaignStart: Date | null;
}

/**
 * Идемпотентно создаёт/обновляет канал по уникальному username.
 * Возвращает id канала — он нужен как внешний ключ для постов и пулов.
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
 * Создаёт ПУСТОЙ канал (без контент-плана/пулов) для мультиканальности (Шаг 8a).
 * Минимум полей: название от владельца + ниша-заглушка; остальное — дефолты схемы
 * (язык ru, пояс Europe/Moscow, isActive, пустые triggerWords). Отдельно от
 * `upsertChannel` (тот по username, для сида). Возвращает id нового канала.
 */
export async function createChannel(
  prisma: PrismaClient,
  data: { title: string },
): Promise<string> {
  const channel = await prisma.channel.create({
    data: { title: data.title, niche: "—" },
    select: { id: true },
  });
  return channel.id;
}

/** Включает/выключает канал (Шаг 8a). Неактивный канал рантайм не ведёт. */
export async function setChannelActive(
  prisma: PrismaClient,
  id: string,
  isActive: boolean,
): Promise<void> {
  await prisma.channel.update({ where: { id }, data: { isActive } });
}

/** Отображаемые данные канала для экрана «Статус». */
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
