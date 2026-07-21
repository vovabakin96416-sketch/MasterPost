import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Шифрование секретов, которые обязаны лежать в БД (Шаг 14b-bis-1).
 *
 * ЧИСТАЯ логика (без Telegram/БД/env): на входе строка и ключ, на выходе строка.
 * Первый и пока единственный потребитель — bot-токен клиента (`BotAccount`):
 * токен даёт полный контроль над каналами владельца, поэтому дамп базы не должен
 * его выдавать.
 *
 * AES-256-GCM (аутентифицированное шифрование): подмена шифротекста не даёт
 * «другой токен», а честно проваливает расшифровку — именно то, что нужно, когда
 * значение уходит в Bot API от имени клиента.
 *
 * Формат хранения: `v1:<iv-hex>:<tag-hex>:<ciphertext-hex>`. Версия в префиксе —
 * чтобы смену алгоритма/ключа можно было провести, не гадая, чем зашифрована строка.
 */

/** Версия формата — растёт при смене алгоритма (старые строки останутся читаемыми). */
export const CIPHER_VERSION = "v1";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // рекомендованная длина nonce для GCM
const PARTS = 4;

/**
 * Минимальная длина ключа из env. Не «криптографическое» требование (ключ всё
 * равно прогоняется через SHA-256), а защита от `BOT_TOKEN_ENC_KEY=1` в проде.
 */
export const MIN_KEY_LENGTH = 16;

/**
 * Приводит произвольную парольную строку из env к 32 байтам ключа AES.
 * Позволяет владельцу положить в Railway обычную длинную фразу, а не hex ровно
 * нужной длины — меньше шансов ошибиться при настройке.
 */
function deriveKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

/** Шифрует секрет. Каждый вызов даёт новый iv → одинаковые токены не совпадают в БД. */
export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return [
    CIPHER_VERSION,
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/**
 * Расшифровывает секрет. Возвращает `null` на ЛЮБОЙ проблеме: другой ключ,
 * подмена/порча строки, чужой формат, незнакомая версия. Исключение здесь было бы
 * хуже — сбой одного клиентского токена не должен ронять старт процесса
 * (14b-bis-2), он должен превращаться в «этот бот не поднялся, вот причина».
 */
export function decryptSecret(payload: string, key: string): string | null {
  const parts = payload.split(":");
  if (parts.length !== PARTS || parts[0] !== CIPHER_VERSION) {
    return null;
  }
  const [, ivHex, tagHex, dataHex] = parts;
  if (ivHex === undefined || tagHex === undefined || dataHex === undefined) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(key),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
