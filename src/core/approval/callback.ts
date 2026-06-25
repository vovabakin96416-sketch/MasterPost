/**
 * Протокол callback-data кнопок одобрения постов (Шаг 5).
 *
 * ЧИСТАЯ логика (без grammY/БД). Отдельный префикс `ap` — не `m` меню: кнопки
 * приходят на превью-сообщении, а не в меню, и обрабатываются своим композером
 * `approval`. Формат: `ap:<action>:<id>`, где id — cuid строки `PendingPost`
 * (~25 символов) → всё помещается в лимит Telegram 64 байта.
 */

export const AP_PREFIX = "ap";
const SEP = ":";

/** Действия экрана одобрения. Фото-кнопки (другое/своё фото) — Шаг 6. */
export type ApprovalAction = "pub" | "edit" | "skip" | "cancel";

const ACTIONS: readonly ApprovalAction[] = ["pub", "edit", "skip", "cancel"];

export interface ApprovalCb {
  readonly action: ApprovalAction;
  readonly id: string;
}

/** Строит callback-data кнопки одобрения. */
export function encodeApproval(action: ApprovalAction, id: string): string {
  return [AP_PREFIX, action, id].join(SEP);
}

/**
 * Разбирает callback-data одобрения. `null`, если это не наш протокол (чужой
 * префикс / неизвестное действие / пустой id) — вызывающий тогда передаёт апдейт
 * дальше (`next`), чтобы его поймал другой композер.
 */
export function decodeApproval(data: string): ApprovalCb | null {
  const parts = data.split(SEP);
  if (parts.length !== 3 || parts[0] !== AP_PREFIX) {
    return null;
  }
  const action = parts[1];
  const id = parts[2];
  if (!isAction(action) || id === undefined || id === "") {
    return null;
  }
  return { action, id };
}

function isAction(value: string | undefined): value is ApprovalAction {
  return value !== undefined && (ACTIONS as readonly string[]).includes(value);
}
