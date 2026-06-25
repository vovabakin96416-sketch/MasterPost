import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../client.js";
import type { PostSeed } from "../../core/content/postSchema.js";
import type { Weekday } from "../../core/schedule/localDate.js";

/** Пост, готовый к публикации (текст + источники фото; кнопки — Шаг 6b). */
export interface PostToPublish {
  externalId: number; // исходный id контент-плана — для трассировки снимка одобрения
  title: string;
  text: string;
  cta: string;
  pexelsQuery: string | null; // запрос для подбора фото (Шаг 6a)
  photoPath: string | null; // локальный файл из контент-плана (Шаг 6a)
}

/**
 * Возвращает посты канала на день (неделя+день) по порядку их собственного времени.
 *
 * Доработка 4.1: расписание больше не делит посты на «утро/вечер». Берём все посты
 * дня, упорядоченные по полю `time` (затем `externalId`), и публикуем их по порядку
 * в заданные админом времена. Текст + источники фото (Шаг 6a); кнопки — Шаг 6b.
 */
export async function getPostsForDay(
  prisma: PrismaClient,
  channelId: string,
  week: number,
  day: Weekday,
): Promise<PostToPublish[]> {
  return prisma.post.findMany({
    where: { channelId, week, day },
    select: {
      externalId: true,
      title: true,
      text: true,
      cta: true,
      pexelsQuery: true,
      photoPath: true,
    },
    orderBy: [{ time: "asc" }, { externalId: "asc" }],
  });
}

/** Источники фото поста контент-плана (для «🔄 Другое фото» на одобрении, Шаг 6a). */
export async function getPostPhotoSources(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<{ pexelsQuery: string | null; photoPath: string | null } | null> {
  return prisma.post.findUnique({
    where: { channelId_externalId: { channelId, externalId } },
    select: { pexelsQuery: true, photoPath: true },
  });
}

/**
 * Идемпотентно создаёт/обновляет пост канала по паре (channelId, externalId).
 *
 * ⚠️ Nullable-Json-поля (choices, button): при отсутствии значения Prisma требует
 * не `null`, а `Prisma.DbNull` (записать SQL NULL в JSON-колонку).
 */
export async function upsertPost(
  prisma: PrismaClient,
  channelId: string,
  seed: PostSeed,
): Promise<void> {
  const data: Prisma.PostUncheckedCreateInput = {
    channelId,
    externalId: seed.externalId,
    week: seed.week,
    day: seed.day,
    slot: seed.slot,
    time: seed.time,
    title: seed.title,
    text: seed.text,
    cta: seed.cta,
    interactiveType: seed.interactiveType,
    keyword: seed.keyword,
    reactions: seed.reactions,
    choices: seed.choices ?? Prisma.DbNull,
    button: seed.button ?? Prisma.DbNull,
    pexelsQuery: seed.pexelsQuery,
    photoPath: seed.photoPath,
  };

  await prisma.post.upsert({
    where: { channelId_externalId: { channelId, externalId: seed.externalId } },
    create: data,
    update: data,
  });
}
