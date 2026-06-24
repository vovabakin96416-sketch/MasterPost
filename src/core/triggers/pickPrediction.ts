/**
 * Выбор предсказания из пула и подстановка шаблона `{name}`.
 *
 * ЧИСТАЯ логика (без Telegram/БД): пул приходит из `TextPool` канала, имя — из
 * Telegram-слоя. `rng` инъектируется ради детерминизма в тестах (по умолчанию
 * `Math.random`). Замена `random.choice(pool).replace("{name}", name)` Python-бота.
 */

/** Подставляет имя во ВСЕ вхождения `{name}` (split/join — без regex-экранирования). */
export function renderTemplate(template: string, vars: { name: string }): string {
  return template.split("{name}").join(vars.name);
}

/**
 * Берёт случайный текст из пула и подставляет имя. Пустой пул → `null`
 * (вызывающий молчит, как Python при `if not pool: return`).
 */
export function pickPrediction(
  pool: readonly string[],
  name: string,
  rng: () => number = Math.random,
): string | null {
  if (pool.length === 0) {
    return null;
  }
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const chosen = pool[index];
  if (chosen === undefined) {
    return null;
  }
  return renderTemplate(chosen, { name });
}
