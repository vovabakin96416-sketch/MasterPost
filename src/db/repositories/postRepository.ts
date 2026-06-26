import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../client.js";
import {
  buttonSchema,
  choiceSchema,
  type Button,
  type Choice,
  type PostSeed,
} from "../../core/content/postSchema.js";
import type { Weekday } from "../../core/schedule/localDate.js";

/** Тип интерактива поста (совпадает с enum InteractiveType в schema.prisma). */
export type InteractiveType =
  | "keyword_trigger"
  | "button_choice"
  | "button_prediction"
  | "vote_123";

/** Поля интерактива поста (для построения кнопок, Шаг 6b). */
export interface PostInteractive {
  interactiveType: InteractiveType;
  choices: Choice[] | null; // button_choice: [{label, answer}]
  button: Button | null; // button_prediction: {type, label}
}

/** Пост, готовый к публикации (текст + источники фото + интерактив для кнопок). */
export interface PostToPublish extends PostInteractive {
  externalId: number; // исходный id контент-плана — для трассировки снимка одобрения
  title: string;
  text: string;
  cta: string;
  pexelsQuery: string | null; // запрос для подбора фото (Шаг 6a)
  photoPath: string | null; // локальный файл из контент-плана (Шаг 6a)
}

/** Защитный разбор Json-поля `choices` в типизированные варианты (битое → null). */
function parseChoices(value: Prisma.JsonValue): Choice[] | null {
  const result = choiceSchema.array().safeParse(value);
  return result.success ? result.data : null;
}

/** Защитный разбор Json-поля `button` в типизированную кнопку (битое → null). */
function parseButton(value: Prisma.JsonValue): Button | null {
  const result = buttonSchema.safeParse(value);
  return result.success ? result.data : null;
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
  const rows = await prisma.post.findMany({
    where: { channelId, week, day },
    select: {
      externalId: true,
      title: true,
      text: true,
      cta: true,
      pexelsQuery: true,
      photoPath: true,
      interactiveType: true,
      choices: true,
      button: true,
    },
    orderBy: [{ time: "asc" }, { externalId: "asc" }],
  });
  return rows.map((row) => ({
    ...row,
    choices: parseChoices(row.choices),
    button: parseButton(row.button),
  }));
}

/**
 * Поля интерактива поста по (channelId, externalId) — для построения кнопок при
 * публикации ОДОБРЕННОГО поста (у снимка `PendingPost` этих полей нет, берём из
 * исходного `Post`). `null`, если поста нет.
 */
export async function getPostInteractive(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<PostInteractive | null> {
  const row = await prisma.post.findUnique({
    where: { channelId_externalId: { channelId, externalId } },
    select: { interactiveType: true, choices: true, button: true },
  });
  if (row === null) {
    return null;
  }
  return {
    interactiveType: row.interactiveType,
    choices: parseChoices(row.choices),
    button: parseButton(row.button),
  };
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
