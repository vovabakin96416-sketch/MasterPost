import { z } from "zod";

/**
 * Схема и маппинг постов контент-плана «канала №1» (таро).
 *
 * Это ЧИСТАЯ логика границы данных: сырой JSON (snake_case, как в исходном
 * content.json Python-бота) проверяется zod и превращается в форму под Prisma
 * (camelCase). Ни Telegram, ни БД тут не участвуют — поэтому всё покрыто тестами.
 */

// enum-значения совпадают со схемой Prisma (schema.prisma) как есть.
export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const slotSchema = z.enum(["morning", "evening"]);

export const interactiveTypeSchema = z.enum([
  "keyword_trigger",
  "button_choice",
  "button_prediction",
  "vote_123",
]);

export const choiceSchema = z.object({
  label: z.string().min(1),
  answer: z.string().min(1),
});

export const buttonSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
});

/** Вариант ответа `button_choice` (метка кнопки + заготовленный ответ). */
export type Choice = z.infer<typeof choiceSchema>;

/** Кнопка `button_prediction` (тип = ключ пула + метка на кнопке). */
export type Button = z.infer<typeof buttonSchema>;

/**
 * Сырой пост ровно в том виде, в каком лежит в content.json (snake_case,
 * nullable-поля приходят как null). `.strict()` ловит лишние/опечатанные ключи.
 */
export const rawPostSchema = z
  .object({
    id: z.number().int().positive(),
    week: z.number().int().positive(),
    day: weekdaySchema,
    slot: slotSchema,
    time: z.string().min(1),
    title: z.string().min(1),
    text: z.string().min(1),
    cta: z.string().min(1),
    interactive_type: interactiveTypeSchema,
    keyword: z.string().min(1).nullable(),
    reactions: z.array(z.string()),
    choices: z.array(choiceSchema).nullable(),
    button: buttonSchema.nullable(),
    pexels_query: z.string().nullable(),
    photo_path: z.string().nullable(),
  })
  .strict();

export type RawPost = z.infer<typeof rawPostSchema>;

export const rawPostsSchema = z.array(rawPostSchema);

/**
 * Пост в форме под запись в БД. `null` (а не `undefined`) для отсутствующих
 * nullable-полей — из-за exactOptionalPropertyTypes и нюанса Prisma с Json-null
 * (см. postRepository, где null превращается в Prisma.DbNull).
 */
export interface PostSeed {
  externalId: number;
  week: number;
  day: z.infer<typeof weekdaySchema>;
  slot: z.infer<typeof slotSchema>;
  time: string;
  title: string;
  text: string;
  cta: string;
  interactiveType: z.infer<typeof interactiveTypeSchema>;
  keyword: string | null;
  reactions: string[];
  choices: z.infer<typeof choiceSchema>[] | null;
  button: z.infer<typeof buttonSchema> | null;
  pexelsQuery: string | null;
  photoPath: string | null;
}

/** Маппинг сырого поста (snake_case) → форму под Prisma (camelCase). */
export function toPostSeed(raw: RawPost): PostSeed {
  return {
    externalId: raw.id,
    week: raw.week,
    day: raw.day,
    slot: raw.slot,
    time: raw.time,
    title: raw.title,
    text: raw.text,
    cta: raw.cta,
    interactiveType: raw.interactive_type,
    keyword: raw.keyword,
    reactions: raw.reactions,
    choices: raw.choices,
    button: raw.button,
    pexelsQuery: raw.pexels_query,
    photoPath: raw.photo_path,
  };
}

/** Разбирает и валидирует массив сырых постов, возвращает форму под БД. */
export function parsePosts(input: unknown): PostSeed[] {
  return rawPostsSchema.parse(input).map(toPostSeed);
}
