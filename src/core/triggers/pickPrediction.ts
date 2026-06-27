/**
 * Выбор предсказания из пула без повторов («колода») и подстановка `{name}`.
 *
 * ЧИСТАЯ логика (без Telegram/БД): пул приходит из `TextPool` канала, имя — из
 * Telegram-слоя, «память» недавно показанных — из строки `Cooldown`. `rng`
 * инъектируется ради детерминизма в тестах (по умолчанию `Math.random`).
 */

/** Подставляет имя во ВСЕ вхождения `{name}` (split/join — без regex-экранирования). */
export function renderTemplate(template: string, vars: { name: string }): string {
  return template.split("{name}").join(vars.name);
}

/** Префикс для ответа анонимному отправителю (комментарий от имени канала/группы). */
export const ANON_PREFIX = "❤️ Лови послание:";

/**
 * Рендер для анонима (`GroupAnonymousBot`): убираем обращение по имени и даём
 * нейтральный префикс. Срезаем ведущее `"{name}, "` (и подчищаем любые остаточные
 * `{name}`), первую букву тела делаем заглавной, сверху — `ANON_PREFIX`.
 * Память анти-повтора считается по сырому шаблону, поэтому от рендера не зависит.
 */
export function renderAnonymous(template: string): string {
  const body = template
    .replace("{name}, ", "")
    .split("{name}")
    .join("")
    .replace(/^(\S+\s+)(\p{Ll})/u, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
  return `${ANON_PREFIX}\n\n${body}`;
}

/**
 * Стабильный короткий ключ ответа (djb2 → base36). По СОДЕРЖИМОМУ, а не индексу:
 * переживает правки/удаление/перестановку ответов в админке, поэтому «память»
 * анти-повтора не сбивается при редактировании пула.
 */
export function answerKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  // >>> 0 — в беззнаковое 32-битное, чтобы ключ был стабильным и положительным.
  return (hash >>> 0).toString(36);
}

/** Результат выбора без повтора: текст для ответа + обновлённая «память». */
export interface NoRepeatPick {
  text: string;
  recentKeys: string[];
}

/**
 * Выбор по принципу «колода»: человек увидит ВСЕ ответы пула, прежде чем хоть
 * один повторится.
 *
 * - кандидаты = ответы, чьих ключей нет в `recentKeys`; если пусто (пул ужался
 *   или память переполнена) — сброс, кандидаты = весь пул;
 * - выбранный ключ дописываем в память, обрезая до `poolSize − 1` (этого хватает,
 *   чтобы исключить все, кроме одного, и гарантировать полный цикл);
 * - память чистим от ключей, которых уже нет в пуле (ответы удалили/переписали).
 *
 * ЧИСТАЯ функция: на вход пул + память, на выход текст + новая память (её кладёт
 * в БД вызывающий). Пустой пул → `null`.
 */
export function pickPredictionNoRepeat(
  pool: readonly string[],
  recentKeys: readonly string[],
  name: string,
  rng: () => number = Math.random,
  render: (template: string, name: string) => string = (t, n) =>
    renderTemplate(t, { name: n }),
): NoRepeatPick | null {
  if (pool.length === 0) {
    return null;
  }
  const keys = pool.map(answerKey);
  const poolKeySet = new Set(keys);
  const recentSet = new Set(recentKeys.filter((k) => poolKeySet.has(k)));

  let candidates = pool
    .map((text, i) => ({ text, key: keys[i] ?? "" }))
    .filter((c) => !recentSet.has(c.key));
  if (candidates.length === 0) {
    candidates = pool.map((text, i) => ({ text, key: keys[i] ?? "" }));
  }

  const index = Math.min(
    candidates.length - 1,
    Math.floor(rng() * candidates.length),
  );
  const chosen = candidates[index];
  if (chosen === undefined) {
    return null;
  }

  // Память = живые недавние + выбранный (без дубля), обрезаем слева до poolSize − 1.
  recentSet.delete(chosen.key);
  const keep = Math.max(0, pool.length - 1);
  const nextRecent = [...recentSet, chosen.key].slice(-keep);

  return { text: render(chosen.text, name), recentKeys: nextRecent };
}
