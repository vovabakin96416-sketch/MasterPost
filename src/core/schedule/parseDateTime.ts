import { localDateParts } from "./localDate.js";

/**
 * Разбор даты-времени публикации разового поста (Шаг 6c) — ЧИСТАЯ логика, под тестами.
 *
 * Админ вводит время в ПОЯСЕ канала (`ДД.ММ ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`); нам нужен
 * UTC-инстант, который и сравнит планировщик. Перевод «локальная стена → UTC» делаем
 * через `localDateParts` (instant → части в поясе): подбираем смещение пояса и уточняем
 * его один раз ради корректности на границе перехода на летнее время.
 *
 * Год можно опустить — подставляем текущий год в поясе канала. Проверку «не в прошлом»
 * делает обёртка `validateDateTime` (см. core/menu/validation.ts), здесь — только разбор.
 */

const DATETIME_RE =
  /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+([01]?\d|2[0-3]):([0-5]\d)$/;

function truncateToMinute(ms: number): number {
  return Math.floor(ms / 60000) * 60000;
}

/**
 * Смещение пояса от UTC (мс) для данного инстанта: «стена пояса как UTC» минус сам
 * инстант (округлённый до минуты — `localDateParts` отдаёт минутную точность).
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = localDateParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wallAsUtc - truncateToMinute(instant.getTime());
}

/**
 * Превращает локальные части (стена пояса) в UTC-инстант. Два прохода: первая оценка
 * смещения по «наивному UTC», затем уточнение по полученному инстанту (DST-граница).
 */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(new Date(naiveUtc), timeZone);
  let utc = naiveUtc - offset1;
  const offset2 = tzOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset1) {
    utc = naiveUtc - offset2;
  }
  return new Date(utc);
}

/**
 * Разбирает ввод даты-времени в поясе `timeZone` → UTC `Date` или `null` (кривой
 * формат / несуществующая дата). `now` нужен только для подстановки года, если он опущен.
 *
 * Несуществующие даты (31.02, либо «дыра» весеннего перевода часов) отсекаем
 * круговой проверкой: после перевода в UTC раскладываем обратно в пояс и сверяем все
 * поля — при расхождении возвращаем `null`.
 */
export function parseDateTime(
  input: string,
  timeZone: string,
  now: Date,
): Date | null {
  const m = DATETIME_RE.exec(input.trim());
  if (m === null) {
    return null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] !== undefined ? Number(m[3]) : localDateParts(now, timeZone).year;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const utc = zonedWallToUtc(year, month, day, hour, minute, timeZone);
  // Круговая проверка: дата/время должны воспроизвестись в том же поясе без сдвига.
  const back = localDateParts(utc, timeZone);
  if (
    back.year !== year ||
    back.month !== month ||
    back.day !== day ||
    back.hour !== hour ||
    back.minute !== minute
  ) {
    return null;
  }
  return utc;
}
