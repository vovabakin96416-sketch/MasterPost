import { normalizeTriggerText } from "./matchTrigger.js";

/**
 * «Сообщение СОДЕРЖИТ триггер-слово» — для AI-ответов в комментах (Шаг 11c).
 *
 * В отличие от `matchTrigger` (равенство ВСЕГО сообщения, пул готовых текстов),
 * здесь слово может стоять внутри фразы: «а что скажет карта на этой неделе?».
 * ЧИСТАЯ логика без БД/сети — как `matchTrigger`, та же нормализация
 * `normalizeTriggerText` для обеих сторон.
 *
 * Сравнение — по границам слов (обрамляем пробелами), поэтому «кот» НЕ совпадает
 * с «который», а многословный триггер («карта дня») матчится как подстрока-фраза.
 * Возвращаем исходную форму совпавшего слова (как задано в наборе) или `null`.
 */
export function containsTrigger(
  text: string,
  triggerWords: readonly string[],
): string | null {
  const normalized = normalizeTriggerText(text);
  if (normalized === "") {
    return null;
  }
  // Обрамление пробелами даёт границы слова для `includes` (и в начале, и в конце).
  const haystack = ` ${normalized} `;
  for (const word of triggerWords) {
    const needle = normalizeTriggerText(word);
    if (needle === "") {
      continue;
    }
    if (haystack.includes(` ${needle} `)) {
      return word;
    }
  }
  return null;
}
