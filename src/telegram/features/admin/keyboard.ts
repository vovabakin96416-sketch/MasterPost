import { InlineKeyboard } from "grammy";
import { encodeCb } from "../../../core/menu/callbackData.js";

/**
 * Конструктор inline-клавиатур меню. Описываем кнопки декларативно (массив рядов),
 * хелпер собирает grammY `InlineKeyboard` и единообразно добавляет навигацию
 * «Назад»/«Домой». Новый экран = пара строк, вид одинаковый везде.
 */

/** Одна callback-кнопка: подпись + готовая callback-data (см. encodeCb). */
export interface Btn {
  readonly label: string;
  readonly data: string;
}

/** Собирает `InlineKeyboard` из рядов кнопок. */
export function buildKeyboard(rows: Btn[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    if (i > 0) {
      kb.row();
    }
    for (const btn of row) {
      kb.text(btn.label, btn.data);
    }
  });
  return kb;
}

/**
 * Ряд навигации. На главном меню `backData` не передаём (там некуда «назад»);
 * на остальных экранах — «Назад» к родителю + «Домой» в главное меню.
 */
export function navRow(backData?: string): Btn[] {
  const row: Btn[] = [];
  if (backData !== undefined) {
    row.push({ label: "◀ Назад", data: backData });
  }
  row.push({ label: "🏠 Домой", data: encodeCb("home") });
  return row;
}

/**
 * Ряд пагинации (◀/▶) для списков. Кнопки появляются только когда есть куда
 * листать. `make(page)` строит callback-data перехода на страницу.
 */
export function pageRow(
  page: number,
  hasPrev: boolean,
  hasNext: boolean,
  make: (page: number) => string,
): Btn[] {
  const row: Btn[] = [];
  if (hasPrev) {
    row.push({ label: "◀", data: make(page - 1) });
  }
  if (hasNext) {
    row.push({ label: "▶", data: make(page + 1) });
  }
  return row;
}

/** Однострочный предпросмотр текста для подписи кнопки (без переводов строк). */
export function preview(text: string, max = 30): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
