import { z } from "zod";

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
});

export type Env = z.infer<typeof envSchema>;

/**
 * Разбирает и валидирует окружение. Вынесено в функцию ради тестируемости —
 * можно передать произвольный источник вместо process.env.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
