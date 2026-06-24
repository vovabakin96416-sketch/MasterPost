import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../client.js";
import type { PostSeed } from "../../core/content/postSchema.js";
import type { Weekday } from "../../core/schedule/localDate.js";
import type { SlotName } from "../../core/schedule/dueSlots.js";

/** Пост, готовый к публикации (Шаг 4 — только текст; фото/кнопки — Шаги 5–6). */
export interface PostToPublish {
  title: string;
  text: string;
  cta: string;
}

/**
 * Находит пост канала на сегодня по (неделя, день, слот) — порт `get_post_for_today`.
 * Возвращает только текстовые поля (Шаг 4); `null`, если поста нет.
 */
export async function getPostForToday(
  prisma: PrismaClient,
  channelId: string,
  week: number,
  day: Weekday,
  slot: SlotName,
): Promise<PostToPublish | null> {
  return prisma.post.findFirst({
    where: { channelId, week, day, slot },
    select: { title: true, text: true, cta: true },
    orderBy: { externalId: "asc" },
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
