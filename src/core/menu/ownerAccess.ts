/**
 * Правила управления доступом владельцев (Шаг 14b-4) — ЧИСТАЯ логика, под тестами.
 *
 * Пригласить владельца умеем с 14b-1, отозвать доступ — нет. Отзыв необратим для
 * доступа, поэтому решение «можно ли отзывать» вынесено сюда: один источник правды
 * и для отрисовки кнопки, и для перепроверки callback'а (кнопку видно только
 * супервладельцу, но callback можно скрафтить).
 *
 * Telegram id сравниваем СТРОКАМИ: в БД `Owner.telegramUserId` хранится строкой,
 * а `ctx.from.id` приходит числом — приведение к строке не теряет точность.
 */

/** Результат проверки: можно отзывать, либо причина отказа (текст для владельца). */
export type RevokeOwnerCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface RevokeOwnerInput {
  /** Кто нажал (`ctx.from.id`). */
  readonly viewerUserId: number;
  /** Супервладелец бота (`ADMIN_ID`). */
  readonly adminId: number;
  /** Telegram id того, у кого отзывают доступ (как в БД — строкой). */
  readonly targetTelegramUserId: string;
}

/** Отказ, когда доступ отзывает не супервладелец. */
export const REVOKE_DENIED_NOT_ADMIN =
  "Управлять доступом владельцев может только владелец бота.";

/** Отказ, когда пытаются отозвать доступ у супервладельца (в т.ч. у себя). */
export const REVOKE_DENIED_SELF =
  "Нельзя отозвать доступ у владельца бота — иначе бот останется без хозяина.";

/**
 * Можно ли отозвать доступ у владельца.
 *
 * Правила: (1) управлять доступом вправе только супервладелец; (2) супервладельца
 * (а значит и самого себя) отозвать нельзя — он гейт всего управления доступом.
 */
export function canRevokeOwner(input: RevokeOwnerInput): RevokeOwnerCheck {
  if (input.viewerUserId !== input.adminId) {
    return { ok: false, error: REVOKE_DENIED_NOT_ADMIN };
  }
  const target = input.targetTelegramUserId.trim();
  if (target === String(input.adminId) || target === String(input.viewerUserId)) {
    return { ok: false, error: REVOKE_DENIED_SELF };
  }
  return { ok: true };
}
