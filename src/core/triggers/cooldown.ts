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

/**
 * Сколько дней держать строку ПОСЛЕ истечения кулдауна (аудит 2026-07: таблица
 * растёт без чистки). НЕ чистим сразу по `expiresAt < now`: строка несёт «колоду»
 * анти-повтора (`recent`), которая читается и после истечения срока — удаление
 * сразу сбрасывало бы память ответов активным пользователям.
 */
export const COOLDOWN_RETENTION_DAYS = 30;

/**
 * Граница чистки: строки с `expiresAt` СТАРШЕ этой даты можно удалять — пользователь
 * не проявлялся дольше срока хранения, его «колода» уже неактуальна.
 */
export function cooldownPurgeCutoff(now: Date): Date {
  return new Date(now.getTime() - COOLDOWN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
