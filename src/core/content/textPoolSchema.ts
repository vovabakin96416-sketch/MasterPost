import { z } from "zod";

/**
 * Схема и нормализация пулов текстов-предсказаний «канала №1» (замена
 * DEFAULT_TEXTS / texts.json Python-бота). Граница данных, чистая логика.
 *
 * Формат источника — словарь `ключ → массив строк` (каждая строка может
 * содержать плейсхолдер `{name}`; шаблонизация — на Шаге 2, тут не трогаем).
 */
export const textPoolsSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).nonempty(),
);

export type TextPools = z.infer<typeof textPoolsSchema>;

/** Один пул в форме под запись в БД (TextPool: key + texts[]). */
export interface TextPoolSeed {
  key: string;
  texts: string[];
}

/** Разбирает словарь и нормализует в массив пулов под БД. */
export function parseTextPools(input: unknown): TextPoolSeed[] {
  const pools = textPoolsSchema.parse(input);
  return Object.entries(pools).map(([key, texts]) => ({ key, texts }));
}
