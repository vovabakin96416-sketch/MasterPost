import type { Context } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";

/**
 * Каркас конвейера обработки комментариев канала.
 *
 * Композер прогоняет сообщение через стадии по порядку
 * `[модерация] → [триггер] → [AI-ответ]` до первой, которая вернёт `"handled"`.
 * Каждая стадия изолирована и заменяема: модерация и AI сейчас — no-op заглушки
 * (точки расширения под Шаги 9 и 11), реальное поведение даёт только триггер.
 */

/** Общие зависимости стадий. */
export interface CommentDeps {
  prisma: PrismaClient;
  logger: Logger;
}

/** Результат стадии: `handled` — обработано (стоп), `pass` — передать дальше. */
export type StageResult = "handled" | "pass";

/** Одна стадия конвейера. */
export interface CommentStage {
  readonly name: string;
  handle(ctx: Context, deps: CommentDeps): Promise<StageResult>;
}
