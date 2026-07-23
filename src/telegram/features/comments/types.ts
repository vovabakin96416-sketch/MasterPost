import type { Context } from "grammy";
import type { Logger } from "pino";
import type { RoutableChannel } from "../../../core/comments/routeChannel.js";
import type { PrismaClient } from "../../../db/client.js";
import type { OwnerBotRegistry } from "../../../services/botRegistry.js";

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
  // Шаг 11d: адресат сигнала о спаме из стадии модерации. В рантайме приходит из
  // `BotDeps` (env.ADMIN_ID). Шаг 14b-2: это ФОЛБЭК — сигнал идёт владельцу КАНАЛА,
  // а супервладельцу лишь когда у канала владельца нет.
  adminId: number;
  // Шаг 11c: ключ Anthropic для AI-ответа в комментах. undefined → стадия молчит
  // (мягкая деградация, как для кнопки «🤖 AI-пост»). Приходит из `BotDeps`.
  anthropicApiKey?: string | undefined;
  // Шаг 11b: таймаут вызова Claude (мс); undefined → DEFAULT_AI_TIMEOUT_MS.
  timeoutMs?: number | undefined;
  // Шаг 14b-bis-4: разграничение общий/клиентский бот в обсуждении.
  // `clientOwnerUserId` — Telegram-id владельца, если бот поднят как БОТ КЛИЕНТА
  // (undefined → общий бот). `ownerBots` — реестр ботов клиентов: по нему общий бот
  // узнаёт, что у владельца канала поднят свой бот (тогда общий молчит). Оба
  // приходят из `BotDeps` (см. `createBot`).
  clientOwnerUserId?: number | undefined;
  ownerBots?: OwnerBotRegistry | undefined;
}

/** Результат стадии: `handled` — обработано (стоп), `pass` — передать дальше. */
export type StageResult = "handled" | "pass";

/**
 * Одна стадия конвейера. Канал резолвится ОДИН раз в композере (аудит 2026-07:
 * было 3 стадии × 2 SELECT'а на каждый коммент) и приходит готовым — вместе с уже
 * пройденным гейтом принадлежности бота (14b-bis-4).
 */
export interface CommentStage {
  readonly name: string;
  handle(
    ctx: Context,
    deps: CommentDeps,
    channel: RoutableChannel,
  ): Promise<StageResult>;
}
