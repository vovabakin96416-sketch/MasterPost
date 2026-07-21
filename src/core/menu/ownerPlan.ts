/**
 * Тариф и срок доступа владельца (Шаг 14e) — ЧИСТАЯ логика, под тестами.
 *
 * До 14e доступ выдавался навсегда: пригласили владельца — он пользуется ботом,
 * пока супервладелец вручную не нажмёт «🚫 Отозвать» (14b-4). Бесплатный триал так
 * не сделать — про сроки бот ничего не знал. Здесь появляется понятие «доступ до
 * такого-то момента»: приглашённый получает `trial` на `TRIAL_DAYS`, по истечении
 * бот перестаёт пускать его в меню сам.
 *
 * Модуль знает только про даты и тариф — ни про Telegram, ни про БД. Один источник
 * правды и для гейта (`/menu`, кнопки, ввод, `/start`, онбординг), и для экрана
 * «👤 Владельцы»: гейт нельзя обойти, скрафтив callback, потому что решение везде
 * принимает эта функция.
 */

/**
 * Тариф владельца.
 * - `trial` — бесплатный доступ до `trialUntil` (после — закрыт).
 * - `active` — бессрочный доступ (супервладелец, платящий клиент).
 *
 * Дефолт в БД — `active`: миграция не должна запирать тех, кто уже пользуется ботом.
 */
export type OwnerPlanKind = "trial" | "active";

/** Длительность бесплатного триала при приглашении (решение владельца, 14e). */
export const TRIAL_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Отказ, когда бесплатный доступ закончился. */
export const ACCESS_DENIED_TRIAL_EXPIRED =
  "Бесплатный доступ закончился. Напиши владельцу бота, если хочешь продолжить.";

/** Результат проверки доступа: пускаем, либо причина отказа (текст для человека). */
export type OwnerAccessCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface OwnerAccessInput {
  readonly plan: OwnerPlanKind;
  /** Момент окончания триала; `null` — срок не задан. */
  readonly trialUntil: Date | null;
  /** «Сейчас» — передаётся снаружи, чтобы функция оставалась чистой. */
  readonly now: Date;
  /** Владелец бота (`ADMIN_ID`) — тариф на него не распространяется. */
  readonly isSuperOwner: boolean;
}

/**
 * Есть ли у владельца доступ прямо сейчас.
 *
 * Правила:
 * 1. Супервладелец проходит ВСЕГДА — иначе кривая дата в его строке заперла бы
 *    единственного человека, который может чинить доступ (та же защита, что в
 *    `canRevokeOwner`: бот не должен остаться без хозяина).
 * 2. `active` — доступ есть.
 * 3. `trial` без даты — доступ есть (fail-open). Такое состояние бот сам не создаёт:
 *    триал всегда ставится вместе со сроком. Запирать человека из-за неполных
 *    данных хуже, чем пустить лишнего — отозвать доступ можно кнопкой.
 * 4. `trial` с датой — доступ есть, пока дата не наступила.
 */
export function checkOwnerAccess(input: OwnerAccessInput): OwnerAccessCheck {
  if (input.isSuperOwner || input.plan === "active") {
    return { ok: true };
  }
  if (input.trialUntil === null) {
    return { ok: true };
  }
  if (input.trialUntil.getTime() <= input.now.getTime()) {
    return { ok: false, error: ACCESS_DENIED_TRIAL_EXPIRED };
  }
  return { ok: true };
}

/** Владелец в объёме, нужном для решения о доступе (форма строки `Owner`). */
export interface OwnerPlanLike {
  readonly telegramUserId: string;
  readonly plan: OwnerPlanKind;
  readonly trialUntil: Date | null;
}

/**
 * Тот же `checkOwnerAccess`, но по строке владельца — точкам входа (`/menu`,
 * кнопки, ввод, `/start`, онбординг) не приходится самим вычислять
 * `isSuperOwner` и тем самым разъезжаться в трактовке.
 */
export function checkOwnerRecordAccess(
  owner: OwnerPlanLike,
  adminId: number,
  now: Date,
): OwnerAccessCheck {
  return checkOwnerAccess({
    plan: owner.plan,
    trialUntil: owner.trialUntil,
    now,
    isSuperOwner: owner.telegramUserId.trim() === String(adminId),
  });
}

/** Момент окончания триала, если начать его сейчас (по умолчанию — `TRIAL_DAYS`). */
export function trialExpiresAt(now: Date, days: number = TRIAL_DAYS): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

/**
 * Продление: считает новый срок от БОЛЬШЕЙ из дат — текущего срока или «сейчас».
 * Продлить не истёкший триал = добавить дни к остатку (иначе продление могло бы
 * его укоротить); продлить истёкший = отсчитать заново от сегодня.
 */
export function extendTrialUntil(
  current: Date | null,
  now: Date,
  days: number = TRIAL_DAYS,
): Date {
  const base =
    current !== null && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * Сколько дней осталось (вверх: «меньше суток» = 1 день). Срок не задан → `null`,
 * истёк → `0`. Нужен экрану «👤 Владельцы» — супервладелец должен видеть остаток,
 * не считая даты в уме.
 */
export function trialDaysLeft(trialUntil: Date | null, now: Date): number | null {
  if (trialUntil === null) {
    return null;
  }
  const ms = trialUntil.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / MS_PER_DAY);
}

/**
 * Строка тарифа для экрана «👤 Владельцы» — плейн-текст без Markdown-эмфазы
 * (правило 12c: один и тот же текст уходит и в разметку, и на плоский экран).
 */
export function formatOwnerPlan(input: OwnerAccessInput): string {
  if (input.isSuperOwner) {
    return "владелец бота";
  }
  if (input.plan === "active") {
    return "бессрочно";
  }
  const left = trialDaysLeft(input.trialUntil, input.now);
  if (left === null) {
    return "триал без срока";
  }
  if (left === 0) {
    return "триал истёк";
  }
  return `триал, осталось ${String(left)} ${pluralDays(left)}`;
}

/** Дни по-русски: 1 день · 2 дня · 5 дней (склонение по последним цифрам). */
function pluralDays(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return "дней";
  }
  switch (n % 10) {
    case 1:
      return "день";
    case 2:
    case 3:
    case 4:
      return "дня";
    default:
      return "дней";
  }
}
