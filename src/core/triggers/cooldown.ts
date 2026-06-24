/**
 * Time-математика кулдауна триггеров. ЧИСТАЯ логика (без БД): состояние кулдауна
 * хранится в таблице `Cooldown`, а здесь — только сравнение времени.
 *
 * Замена `datetime.now() - last < timedelta(hours=COOLDOWN_HOURS)` Python-бота
 * (где COOLDOWN_HOURS = 24). Кулдаун — на пару (пользователь, слово) отдельно.
 */

/** Кулдаун активен, пока момент истечения в будущем относительно `now`. */
export function isOnCooldown(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

/** Момент истечения нового кулдауна: `now + hours`. */
export function nextExpiry(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
