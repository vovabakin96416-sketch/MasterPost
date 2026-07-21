/**
 * Запуск ботов клиентов: чистая часть (Шаг 14b-bis-2).
 *
 * Реестр ботов живёт в сервисе (там grammY и БД), а сюда вынесено то, что можно
 * проверить тестами без сети: как объяснить владельцу, почему его бот не поднялся,
 * и как прочитать Telegram-id владельца, который в БД лежит строкой.
 *
 * ⚠️ ГЛАВНОЕ ПРАВИЛО ЭТОГО МОДУЛЯ: текст ошибки уходит в БД (`BotAccount.lastError`)
 * и на экран «🤖 Мой бот», поэтому в нём НЕ должно оказаться токена — сообщения
 * Bot API его не содержат, но ошибка может прийти откуда угодно (сеть, наш же код),
 * поэтому маскируем на всякий случай.
 */

/** Предел длины `lastError`: строка идёт в сообщение Telegram, а не в лог. */
export const LAST_ERROR_MAX_LENGTH = 200;

/** Токен клиента не расшифровался — почти всегда это смена `BOT_TOKEN_ENC_KEY`. */
export const BOT_ERROR_DECRYPT =
  "не удалось расшифровать токен (сменился ключ шифрования?) — пришли токен заново";

/** Похоже на токен BotFather (`<id>:<секрет>`) — прячем, если он попал в текст. */
const TOKEN_LIKE = /\d{5,}:[A-Za-z0-9_-]{20,}/g;

/**
 * Короткое объяснение сбоя запуска бота для владельца.
 *
 * Частые исходы называем словами: 401 — токен отозван, 409 — на этом токене уже
 * кто-то читает апдейты (второй long polling). Остальное отдаём как есть, обрезав
 * и замаскировав, — «неизвестная ошибка» без подробностей чинить невозможно.
 */
export function describeBotStartError(err: unknown): string {
  const raw = extractMessage(err);
  if (raw.length === 0) {
    return "бот не запустился (причина неизвестна)";
  }
  const masked = raw.replace(TOKEN_LIKE, "<токен скрыт>");
  if (/\b401\b|unauthorized/i.test(masked)) {
    return "Telegram не принял токен (401) — проверь его в @BotFather (/mybots → Revoke выдаёт новый)";
  }
  if (/\b409\b|conflict/i.test(masked)) {
    return "этого бота уже читает другой процесс (409) — он не должен быть запущен где-то ещё";
  }
  return truncate(masked, LAST_ERROR_MAX_LENGTH);
}

/**
 * Telegram-id владельца из БД (строка) в число для сравнения с `ctx.from.id`.
 * `null` на мусоре: бот такого владельца поднимать нельзя — мы не сможем отличить
 * его личку от чужой, а бот клиента обязан обслуживать только своего владельца.
 */
export function parseBotOwnerUserId(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Пускать ли апдейт в хендлеры БОТА КЛИЕНТА (Шаг 14b-bis-2).
 *
 * 🔒 Личка — только своему владельцу: токен этого бота у клиента, значит любые
 * его апдейты клиент вправе прочитать, и чужое меню через него показывать нельзя.
 * Всё остальное (канал, обсуждение, назначение админом) пускаем: там пишут
 * подписчики, и без этого бот клиента не сможет работать с каналом.
 */
export function isClientBotUpdateAllowed(
  chatType: string | undefined,
  fromUserId: number | undefined,
  ownerUserId: number,
): boolean {
  if (chatType !== "private") {
    return true;
  }
  return fromUserId === ownerUserId;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.trim();
  }
  if (typeof err === "string") {
    return err.trim();
  }
  return "";
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
