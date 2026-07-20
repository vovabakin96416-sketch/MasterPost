/**
 * Доступ к одобрению по владельцу канала (Шаг 14b-2, мультитенант).
 *
 * Превью одобрения и служебные уведомления канала адресуются его владельцу
 * (`Owner.telegramUserId`), а кнопки `ap:*` может нажимать только он: id поста
 * очереди приходит в callback-data, и без проверки принадлежности крафтнутая
 * кнопка дотянулась бы до чужого поста (раздел «Безопасность» плана эпика 14).
 * Канал без владельца (`ownerId IS NULL`) обслуживает супервладелец.
 */

/**
 * Telegram-адресат уведомлений/превью канала: его владелец, а без владельца
 * (или с нечитаемым id) — супервладелец. `telegramUserId` хранится строкой,
 * как `chatId`, — для Bot API парсим обратно в число.
 */
export function resolveOwnerTarget(
  ownerTelegramId: string | null,
  superAdminId: number,
): number {
  if (ownerTelegramId === null) {
    return superAdminId;
  }
  const parsed = Number(ownerTelegramId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : superAdminId;
}

/** Может ли пользователь решать судьбу поста канала с таким владельцем. */
export function canActOnChannel(
  userId: number,
  ownerTelegramId: string | null,
  superAdminId: number,
): boolean {
  return userId === resolveOwnerTarget(ownerTelegramId, superAdminId);
}
