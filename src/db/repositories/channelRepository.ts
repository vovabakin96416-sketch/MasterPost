import type { PrismaClient } from "../client.js";

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
