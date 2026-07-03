/**
 * Русское склонение существительного при числе — ЧИСТАЯ логика, под тестами.
 *
 * Одно общее правило (mod10/mod100) вместо копий на каждое слово: формы передаются
 * кортежем `[один, несколько, много]` — «1 ответ / 2 ответа / 5 ответов».
 */

/** Формы слова: [для 1, для 2–4, для 5+/11–14]. */
export type PluralForms = readonly [one: string, few: string, many: string];

/** Возвращает форму слова для числа `n` (неотрицательного целого). */
export function pluralRu(n: number, forms: PluralForms): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return forms[1];
  }
  return forms[2];
}
