/**
 * Разбор bot-токена клиента (Шаг 14b-bis-1).
 *
 * ЧИСТАЯ логика (без grammY/БД): проверяем ФОРМУ токена до похода в Telegram —
 * очевидный мусор (ссылка, @username, обрывок) отсекается без сетевого вызова и
 * без записи в БД. Настоящую проверку «токен живой» делает `getMe` в сервисе:
 * форма не гарантирует работоспособность, а работоспособность не проверить чисто.
 *
 * Формат токена BotFather: `<id бота>:<секрет>`, где id — число, секрет —
 * base64url-подобная строка. Длину секрета Telegram нигде не фиксирует, поэтому
 * требуем разумный минимум, а не точное число символов: жёсткая длина сломалась бы
 * на первом же изменении на стороне Telegram.
 */

export type BotTokenResult =
  | { readonly ok: true; readonly value: BotTokenParts }
  | { readonly ok: false; readonly error: string };

export interface BotTokenParts {
  /** Токен целиком — уходит в Telegram и (зашифрованным) в БД. */
  readonly token: string;
  /** Числовой id бота из префикса токена — сверяется с `getMe`. */
  readonly botUserId: string;
}

/** Минимальная длина секретной части токена. */
const MIN_SECRET_LENGTH = 30;

const TOKEN_RE = new RegExp(
  `^(\\d{5,}):[A-Za-z0-9_-]{${String(MIN_SECRET_LENGTH)},}$`,
);

/**
 * Проверяет и разбирает введённый токен. Пробелы/переводы строк по краям режем:
 * при копировании из BotFather они прилетают почти всегда, и падать на них —
 * издевательство над владельцем.
 */
export function validateBotToken(input: string): BotTokenResult {
  const token = input.trim();
  if (token.length === 0) {
    return { ok: false, error: "Пустое сообщение — пришли токен от @BotFather." };
  }
  const match = TOKEN_RE.exec(token);
  if (match === null) {
    return {
      ok: false,
      error:
        "Не похоже на токен бота. Он выглядит так: 8123456789:AAE_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx — одним сообщением, без лишнего текста.",
    };
  }
  const botUserId = match[1];
  if (botUserId === undefined) {
    return { ok: false, error: "Не удалось разобрать номер бота в токене." };
  }
  return { ok: true, value: { token, botUserId } };
}

/**
 * Маскирует токен для показа владельцу: `8123456789:••••••cQ1c`. Номер бота —
 * не секрет (он же в @username), секретная часть скрыта; последние символы
 * оставлены, чтобы владелец мог отличить один свой токен от другого.
 */
export function maskBotToken(token: string): string {
  const [id, secret] = token.split(":");
  if (id === undefined || secret === undefined) {
    return "•".repeat(8);
  }
  return `${id}:${"•".repeat(6)}${secret.slice(-4)}`;
}
