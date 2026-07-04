import { z } from "zod";

/**
 * Контракт AI-черновика поста (Шаг 10). ЧИСТАЯ граница данных: то, что модель
 * (Claude) возвращает как JSON, проверяется zod и превращается в типобезопасную
 * форму. Ни Telegram, ни БД, ни сети тут нет — поэтому всё покрыто тестами.
 *
 * Поля совпадают с тем, что нужно посту при постановке в очередь одобрения
 * (title/text/cta), плюс `pexelsQuery` — запрос для подбора фото. `pexelsQuery`
 * заложен сразу, чтобы 10b мог чинить «🔄 Другое фото» для AI-постов без правки
 * этого контракта.
 */

/** Разбор AI-черновика: обязательные текстовые поля + запрос фото (или null). */
export const postDraftSchema = z.object({
  // Лишние ключи zod по умолчанию отбрасывает — толерантны к «болтливой» модели.
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
  cta: z.string().trim().min(1),
  // Модель может вернуть строку, null, пустую строку или вовсе опустить поле —
  // всё это приводим к «строка или null» (пусто/пробелы → null).
  pexelsQuery: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    }),
});

/** AI-черновик поста в типобезопасной форме. */
export type PostDraft = z.infer<typeof postDraftSchema>;

/** Валидирует уже разобранный объект (бросает ZodError при несоответствии). */
export function parsePostDraft(raw: unknown): PostDraft {
  return postDraftSchema.parse(raw);
}

/** Снимает markdown-ограждение ```json … ``` вокруг JSON, если оно есть. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced?.[1] ?? text;
}

/**
 * Разбирает ответ модели-строки в `PostDraft`: снимает возможное ```json-ограждение,
 * `JSON.parse`, затем валидирует zod. Structured Outputs отдаёт чистый JSON, но парсер
 * устойчив и к обёртке в код-блок (бросает при кривом JSON/несоответствии схеме).
 */
export function parsePostDraftJson(text: string): PostDraft {
  const raw: unknown = JSON.parse(stripCodeFences(text).trim());
  return parsePostDraft(raw);
}
