/**
 * Протокол callback-data для меню админа.
 *
 * ЧИСТАЯ логика (без grammY/БД): кнопки несут компактную строку, которую Telegram
 * ограничивает 64 байтами. Поэтому в data кладём короткое действие и числовые
 * аргументы-индексы (НЕ сырые слова — кириллица занимает 2 байта/символ и может
 * содержать разделитель). Маппинг индекс↔слово делает экран по актуальному списку
 * из БД на момент рендера.
 *
 * Формат: `m:<action>:<arg1>:<arg2>...` — префикс `m` отделяет меню от чужих
 * callback'ов (кнопки постов Шага 6 и т.п.).
 */

export const CB_PREFIX = "m";
export const CB_SEP = ":";

/** Лимит Telegram на callback_data, байт. */
export const CB_MAX_BYTES = 64;

/** Строит callback-data из действия и аргументов. */
export function encodeCb(action: string, ...args: (string | number)[]): string {
  return [CB_PREFIX, action, ...args.map((a) => String(a))].join(CB_SEP);
}

/** Разобранный callback: действие и строковые аргументы. */
export interface ParsedCb {
  readonly action: string;
  readonly args: readonly string[];
}

/**
 * Разбирает callback-data. Возвращает `null`, если это не наш протокол
 * (чужой префикс / пустое действие / мусор) — вызывающий тогда игнорирует апдейт.
 */
export function decodeCb(data: string): ParsedCb | null {
  const parts = data.split(CB_SEP);
  if (parts.length < 2 || parts[0] !== CB_PREFIX) {
    return null;
  }
  const action = parts[1];
  if (action === undefined || action === "") {
    return null;
  }
  return { action, args: parts.slice(2) };
}

/**
 * Возвращает аргумент как неотрицательное целое или `null`. Используется для
 * индексов (слово/ответ/страница) — кривой ввод не должен валить роутер.
 */
export function intArg(args: readonly string[], i: number): number | null {
  const raw = args[i];
  if (raw === undefined) {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Длина callback-data в байтах (UTF-8) — для проверки лимита Telegram. */
export function cbByteLength(data: string): number {
  return Buffer.byteLength(data, "utf8");
}
