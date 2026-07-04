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
  photoFileId: string | null; // своё загруженное фото (Telegram file_id, Шаг 6c)
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
    where: { channelId, week, day, oneOff: false },
    select: {
      externalId: true,
      title: true,
      text: true,
      cta: true,
      pexelsQuery: true,
      photoPath: true,
      photoFileId: true,
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
 * Один пост канала по (channelId, externalId), готовый к публикации — для отправки
 * конкретного поста на тест из экрана поста («👀 Прислать на тест»). Тот же `select`,
 * что у `getPostsForDay`, но точечно по уникальной паре. `null`, если поста нет.
 */
export async function getPostToPublish(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<PostToPublish | null> {
  const row = await prisma.post.findUnique({
    where: { channelId_externalId: { channelId, externalId } },
    select: {
      externalId: true,
      title: true,
      text: true,
      cta: true,
      pexelsQuery: true,
      photoPath: true,
      photoFileId: true,
      interactiveType: true,
      choices: true,
      button: true,
    },
  });
  if (row === null) {
    return null;
  }
  return {
    ...row,
    choices: parseChoices(row.choices),
    button: parseButton(row.button),
  };
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

/**
 * Подписи пулов кнопок-предсказаний по их `button.type` (доработка 6b): сканирует
 * `button_prediction`-посты канала и возвращает `Map<type, {label}>`. Наличие ключа
 * в Map = пул реально подключён к кнопке поста (плюс человекочитаемая подпись для
 * меню); отсутствие = пул засеян «про запас», ни один пост на него не ссылается.
 */
export async function getButtonPoolMeta(
  prisma: PrismaClient,
  channelId: string,
): Promise<Map<string, { label: string }>> {
  const rows = await prisma.post.findMany({
    where: { channelId, interactiveType: "button_prediction" },
    select: { button: true },
  });
  const meta = new Map<string, { label: string }>();
  for (const row of rows) {
    const button = parseButton(row.button);
    if (button !== null) {
      meta.set(button.type, { label: button.label });
    }
  }
  return meta;
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

/** Образец поста канала для AI-промпта (Шаг 10): только текстовые поля. */
export interface SamplePost {
  title: string;
  text: string;
  cta: string;
}

/**
 * Несколько постов канала как образцы стиля для AI-генерации (Шаг 10). Берём из
 * недельного контент-плана (`oneOff: false`), по порядку `externalId`. Тон канала
 * выводится из его же постов — тематики в коде нет (niche-agnostic).
 */
export async function getSamplePosts(
  prisma: PrismaClient,
  channelId: string,
  limit: number,
): Promise<SamplePost[]> {
  return prisma.post.findMany({
    where: { channelId, oneOff: false },
    select: { title: true, text: true, cta: true },
    orderBy: { externalId: "asc" },
    take: limit,
  });
}

/** Сводка контент-плана: неделя + число постов в ней (Шаг 6.5, список недель). */
export interface PlanWeek {
  week: number;
  count: number;
}

/**
 * Недели контент-плана канала с числом постов в каждой (Шаг 6.5).
 * Постов мало (десятки) → читаем `week` всех постов и сводим в памяти.
 */
export async function getPlanOverview(
  prisma: PrismaClient,
  channelId: string,
): Promise<PlanWeek[]> {
  const rows = await prisma.post.findMany({
    where: { channelId, oneOff: false },
    select: { week: true },
  });
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.week, (counts.get(row.week) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week - b.week);
}

/** Строка списка постов недели (Шаг 6.5): минимум для кнопки + перехода. */
export interface PlanPostRow {
  externalId: number;
  day: Weekday;
  time: string;
  title: string;
  interactiveType: InteractiveType;
}

/**
 * Посты недели по порядку день→время (Шаг 6.5, экран недели).
 * ⚠️ Postgres-enum `Weekday` определён monday…sunday → `orderBy day asc` даёт
 * естественный порядок дней недели, не алфавитный.
 */
export async function getPostsForWeek(
  prisma: PrismaClient,
  channelId: string,
  week: number,
): Promise<PlanPostRow[]> {
  return prisma.post.findMany({
    where: { channelId, week, oneOff: false },
    select: {
      externalId: true,
      day: true,
      time: true,
      title: true,
      interactiveType: true,
    },
    orderBy: [{ day: "asc" }, { time: "asc" }],
  });
}

/** Поле поста, которое редактируем из меню (Шаг 6.5). */
export type EditablePostField = "title" | "text" | "cta";

/** Полные данные поста для экрана редактирования (Шаг 6.5). */
export interface PlanPostDetail {
  externalId: number;
  week: number;
  day: Weekday;
  time: string;
  title: string;
  text: string;
  cta: string;
  interactiveType: InteractiveType;
}

/** Пост по (channelId, externalId) для экрана правки (Шаг 6.5) или `null`. */
export async function getPostDetail(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<PlanPostDetail | null> {
  return prisma.post.findUnique({
    where: { channelId_externalId: { channelId, externalId } },
    select: {
      externalId: true,
      week: true,
      day: true,
      time: true,
      title: true,
      text: true,
      cta: true,
      interactiveType: true,
    },
  });
}

/**
 * Обновляет одно текстовое поле поста контент-плана (Шаг 6.5). Меняет РЕАЛЬНУЮ
 * строку `Post` (не снимок одобрения) → влияет на все будущие публикации этого
 * (week, day). Возвращает `false`, если поста нет (был удалён).
 */
export async function updatePostField(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
  field: EditablePostField,
  value: string,
): Promise<boolean> {
  const result = await prisma.post.updateMany({
    where: { channelId, externalId },
    data: { [field]: value },
  });
  return result.count > 0;
}

/** Удаляет пост контент-плана по (channelId, externalId) (Шаг 6.5). */
export async function deletePost(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<void> {
  await prisma.post.deleteMany({ where: { channelId, externalId } });
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

// ─── Разовый пост вне расписания (Шаг 6c) ─────────────────────────────────────

/** Данные нового разового поста из мастера меню (Шаг 6c). */
export interface NewOneOffPost {
  title: string;
  text: string;
  cta: string;
  interactiveType: InteractiveType;
  choices: Choice[] | null; // button_choice
  button: Button | null; // button_prediction
  pexelsQuery: string | null;
  photoFileId: string | null; // своё загруженное фото (Telegram file_id)
  publishAt: Date;
}

/** Разовый пост, которому пора публиковаться (тик планировщика, Шаг 6c). */
export interface DueOneOffPost extends PostToPublish {
  channelId: string;
}

/** Следующий свободный `externalId` для канала (max+1; для первого поста — 1). */
export async function nextExternalId(
  prisma: PrismaClient,
  channelId: string,
): Promise<number> {
  const agg = await prisma.post.aggregate({
    where: { channelId },
    _max: { externalId: true },
  });
  return (agg._max.externalId ?? 0) + 1;
}

/**
 * Создаёт разовый пост (`oneOff: true`) с собственным `externalId`. `week`/`day`/
 * `slot`/`time` — плейсхолдеры: в недельной выдаче строка не участвует (фильтр
 * `oneOff: false`), публикует её планировщик по `publishAt`. Возвращает `externalId`.
 */
export async function createOneOffPost(
  prisma: PrismaClient,
  channelId: string,
  post: NewOneOffPost,
): Promise<number> {
  const externalId = await nextExternalId(prisma, channelId);
  await prisma.post.create({
    data: {
      channelId,
      externalId,
      oneOff: true,
      publishAt: post.publishAt,
      week: 0,
      day: "monday",
      slot: "morning",
      time: "00:00",
      title: post.title,
      text: post.text,
      cta: post.cta,
      interactiveType: post.interactiveType,
      keyword: null,
      reactions: [],
      choices: post.choices ?? Prisma.DbNull,
      button: post.button ?? Prisma.DbNull,
      pexelsQuery: post.pexelsQuery,
      photoPath: null,
      photoFileId: post.photoFileId,
    },
  });
  return externalId;
}

/**
 * Разовые посты ВСЕХ каналов, которым пора публиковаться: `oneOff`, ещё не
 * опубликованы (`publishedAt: null`) и время настало (`publishAt <= now`). Тик
 * планировщика глобальный — отдаём `channelId`, цель резолвит вызывающий.
 */
export async function getDueOneOffPosts(
  prisma: PrismaClient,
  now: Date,
): Promise<DueOneOffPost[]> {
  const rows = await prisma.post.findMany({
    where: { oneOff: true, publishedAt: null, publishAt: { lte: now } },
    select: {
      channelId: true,
      externalId: true,
      title: true,
      text: true,
      cta: true,
      pexelsQuery: true,
      photoPath: true,
      photoFileId: true,
      interactiveType: true,
      choices: true,
      button: true,
    },
    orderBy: [{ publishAt: "asc" }],
  });
  return rows.map((row) => ({
    ...row,
    choices: parseChoices(row.choices),
    button: parseButton(row.button),
  }));
}

/** Помечает разовый пост опубликованным (дедуп между тиками планировщика). */
export async function markOneOffPublished(
  prisma: PrismaClient,
  channelId: string,
  externalId: number,
): Promise<void> {
  await prisma.post.updateMany({
    where: { channelId, externalId },
    data: { publishedAt: new Date() },
  });
}
