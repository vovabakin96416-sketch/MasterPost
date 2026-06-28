/**
 * Онбординг канала (Шаг 9a) — ЧИСТАЯ логика классификации членства бота и оценки прав.
 * Без grammY/БД: принимает примитивы, извлечённые из ChatMember, → тестируется как остальной
 * `core`. «Подключи канал → работает»: когда бота делают админом канала, мы регистрируем
 * канал и проверяем, может ли он публиковать. Здесь — только решения, без побочных эффектов.
 */

/** Что произошло с членством бота в канале по переходу old→new статуса. */
export type MembershipChange = "promoted" | "demoted" | "removed" | "unchanged";

/** Статусы ChatMember, означающие права администратора (включая владельца). */
const ADMIN_STATUSES: ReadonlySet<string> = new Set(["creator", "administrator"]);
/** Статусы, означающие, что бот покинул чат (убрали/вышел). */
const GONE_STATUSES: ReadonlySet<string> = new Set(["left", "kicked"]);

/**
 * Классифицирует переход членства бота:
 *  - `promoted`  — стал админом (был не-админом);
 *  - `removed`   — убран из чата (left/kicked) из любого статуса;
 *  - `demoted`   — был админом, перестал, но остался в чате (member/restricted);
 *  - `unchanged` — значимого для онбординга изменения нет.
 *
 * `removed` проверяется раньше `demoted`: уход из чата важнее, чем «перестал быть админом».
 */
export function classifyBotMembership(
  oldStatus: string,
  newStatus: string,
): MembershipChange {
  const wasAdmin = ADMIN_STATUSES.has(oldStatus);
  const isAdmin = ADMIN_STATUSES.has(newStatus);

  if (isAdmin && !wasAdmin) {
    return "promoted";
  }
  if (GONE_STATUSES.has(newStatus) && !GONE_STATUSES.has(oldStatus)) {
    return "removed";
  }
  if (wasAdmin && !isAdmin) {
    return "demoted";
  }
  return "unchanged";
}

/** Примитивы прав бота в канале (важно право публикации `can_post_messages`). */
export interface RightsInput {
  isAdmin: boolean;
  canPost: boolean;
}

/**
 * Извлекает примитивы прав из статуса ChatMember бота — мост из grammY в чистую оценку.
 * Владелец (`creator`) имеет все права по умолчанию; у `administrator` право публикации
 * берётся из `can_post_messages` (для каналов оно опционально, поэтому может быть `undefined`).
 */
export function extractRights(
  status: string,
  canPostMessages: boolean | undefined,
): RightsInput {
  const isAdmin = ADMIN_STATUSES.has(status);
  const canPost =
    status === "creator"
      ? true
      : status === "administrator"
        ? (canPostMessages ?? false)
        : false;
  return { isAdmin, canPost };
}

/** Результат оценки прав бота в канале — для сообщения владельцу. */
export interface RightsReport {
  isAdmin: boolean;
  canPost: boolean;
  missing: string[];
  summary: string;
}

/**
 * Оценивает, достаточно ли прав боту для автопостинга в канале. Ключевое право —
 * публиковать сообщения. Возвращает список недостающих прав и короткую сводку для DM.
 */
export function evaluateChannelRights(input: RightsInput): RightsReport {
  const missing: string[] = [];
  if (!input.isAdmin) {
    missing.push("права администратора");
  }
  if (!input.canPost) {
    missing.push("право публиковать сообщения");
  }

  const summary =
    missing.length === 0
      ? "✅ Прав достаточно: бот админ и может публиковать."
      : `⚠️ Не хватает: ${missing.join(", ")}.`;

  return {
    isAdmin: input.isAdmin,
    canPost: input.canPost,
    missing,
    summary,
  };
}
