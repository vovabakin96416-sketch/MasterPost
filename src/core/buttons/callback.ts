/**
 * Протокол callback-data кнопок НА ПОСТАХ канала (Шаг 6b).
 *
 * ЧИСТАЯ логика (без grammY/БД). Отдельный префикс `bp` — не `m` меню и не `ap`
 * одобрения: эти кнопки приходят на опубликованных постах и жмут их любые
 * подписчики канала, а обрабатывает их свой композер `postButtons`.
 *
 * Два вида (порт `send_post` Python-бота):
 * - `button_choice`  → `bp:ch:<channelId>:<externalId>:<idx>` (показать ответ попапом);
 * - `button_prediction` → `bp:pr:<channelId>:<btnType>` (предсказание в личку).
 *
 * `channelId` (cuid) и `btnType` (`button_cards` и т.п.) содержат только [a-z0-9_]
 * без `:`, поэтому split по `:` безопасен. cuid ~25 символов → обе формы влезают
 * в лимит Telegram 64 байта.
 */

export const BP_PREFIX = "bp";
const SEP = ":";

/** Тип кнопки на посте. */
export type PostButtonKind = "choice" | "prediction";

/** Нажата кнопка варианта `button_choice` (нужны канал, пост и индекс варианта). */
export interface ChoiceCb {
  readonly kind: "choice";
  readonly channelId: string;
  readonly externalId: number;
  readonly idx: number;
}

/** Нажата кнопка `button_prediction` (нужны канал и ключ пула предсказаний). */
export interface PredictionCb {
  readonly kind: "prediction";
  readonly channelId: string;
  readonly btnType: string;
}

export type PostButtonCb = ChoiceCb | PredictionCb;

/** callback-data кнопки варианта `button_choice`. */
export function encodeChoiceCb(
  channelId: string,
  externalId: number,
  idx: number,
): string {
  return [BP_PREFIX, "ch", channelId, externalId, idx].join(SEP);
}

/** callback-data кнопки `button_prediction`. */
export function encodePredictionCb(channelId: string, btnType: string): string {
  return [BP_PREFIX, "pr", channelId, btnType].join(SEP);
}

/**
 * Разбирает callback-data кнопки поста. `null`, если это не наш протокол (чужой
 * префикс / неизвестный вид / битые поля) — вызывающий тогда передаёт апдейт
 * дальше (`next`), чтобы его поймал другой композер.
 */
export function decodePostButton(data: string): PostButtonCb | null {
  const parts = data.split(SEP);
  if (parts[0] !== BP_PREFIX) {
    return null;
  }

  if (parts[1] === "ch" && parts.length === 5) {
    const channelId = parts[2] ?? "";
    const externalId = toNonNegInt(parts[3]);
    const idx = toNonNegInt(parts[4]);
    if (channelId === "" || externalId === null || idx === null) {
      return null;
    }
    return { kind: "choice", channelId, externalId, idx };
  }

  if (parts[1] === "pr" && parts.length === 4) {
    const channelId = parts[2] ?? "";
    const btnType = parts[3] ?? "";
    if (channelId === "" || btnType === "") {
      return null;
    }
    return { kind: "prediction", channelId, btnType };
  }

  return null;
}

/** Строка → неотрицательное целое или `null` (битый ввод не должен валить роутер). */
function toNonNegInt(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
