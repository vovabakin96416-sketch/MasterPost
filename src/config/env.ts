import { z } from "zod";
import { MIN_KEY_LENGTH } from "../core/security/tokenCipher.js";

/**
 * Схема переменных окружения. Единственная граница, где «сырой» process.env
 * превращается в типобезопасный конфиг. Кривые/отсутствующие значения падают
 * здесь с понятной ошибкой и не «протекают» внутрь как any.
 */
export const envSchema = z.object({
  BOT_TOKEN: z
    .string({ required_error: "BOT_TOKEN обязателен (токен из @BotFather)" })
    .min(1, "BOT_TOKEN не должен быть пустым"),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL обязателен (строка подключения к PostgreSQL)" })
    .min(1, "DATABASE_URL не должен быть пустым"),
  ADMIN_ID: z.coerce
    .number({ required_error: "ADMIN_ID обязателен (твой Telegram user id)" })
    .int("ADMIN_ID должен быть целым числом")
    .positive("ADMIN_ID должен быть положительным"),
  // Ключ Pexels для подбора фото (Шаг 6a, бесплатная версия). Опционален: без него
  // бот корректно публикует посты без фото (мягкая деградация, как в Python-боте).
  PEXELS_API_KEY: z.string().optional(),
  // MTProto/GramJS для аналитики просмотров (Шаг 7b). Все три ОПЦИОНАЛЬНЫ: без них
  // отчёт по просмотрам (7c) отключён, бот работает как раньше (как с PEXELS_API_KEY).
  // ⚠️ TELEGRAM_SESSION = полный доступ к личному аккаунту — только в env, НЕ в git.
  // Получить api_id/api_hash: my.telegram.org; SESSION: `npm run gen-session`.
  TELEGRAM_API_ID: z.coerce.number().int().positive().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(),
  // Ключ Anthropic (Claude) для AI-генерации постов (Шаг 10). Опционален, как
  // PEXELS_API_KEY: без него генерация тихо отключена (сервис возвращает null),
  // бот работает как раньше. Ключ — только в env, НЕ в git.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Таймаут вызова Claude в мс (Шаг 11b, защита от расхода). Опционален: без него
  // берётся DEFAULT_AI_TIMEOUT_MS. Гарантирует, что зависший запрос не блокирует
  // хендлер/тик надолго (как TIMEOUT_MS у Pexels).
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  // Ключ Telemetr для рыночных данных (Шаг 12e). Опционален, как PEXELS_API_KEY:
  // без него секция «🌍 Рынок» просто не показывается, бот работает как раньше.
  // Ключ — только в env, НЕ в git.
  TELEMETR_API_KEY: z.string().optional(),
  // Ключ шифрования bot-токенов клиентов (Шаг 14b-bis-1). Опционален, как
  // PEXELS_API_KEY: без него экран «🤖 Мой бот» честно говорит «не настроено», и
  // никто не может подключить своего бота — но всё остальное работает как раньше.
  // ⚠️ Обязательным НЕ делаем намеренно: прод уже поднят, и падение старта из-за
  // отсутствующей переменной — цена, несоразмерная функции, которой ещё не пользуются.
  // Ключ — только в env, НЕ в git. Потеря ключа = клиенты вводят токен заново.
  BOT_TOKEN_ENC_KEY: z
    .string()
    .min(
      MIN_KEY_LENGTH,
      `BOT_TOKEN_ENC_KEY должен быть не короче ${String(MIN_KEY_LENGTH)} символов`,
    )
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Разбирает и валидирует окружение. Вынесено в функцию ради тестируемости —
 * можно передать произвольный источник вместо process.env.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
