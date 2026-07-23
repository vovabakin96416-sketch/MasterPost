import { Composer, type Context } from "grammy";
import { createModerationStage } from "./moderationStage.js";
import { createTriggerStage } from "./triggerStage.js";
import { createAiReplyStage } from "./aiReplyStage.js";
import { resolveCommentChannel } from "./routing.js";
import type { CommentDeps, CommentStage } from "./types.js";

/**
 * Композер обработки комментариев канала (Шаг 2). Изолированный модуль: правка
 * триггеров/модерации/AI не задевает остальной бот.
 *
 * Комментарии приходят как текстовые сообщения в связанной группе обсуждений,
 * поэтому слушаем только group/supergroup; личку и команды (/start) не трогаем.
 * Сообщение прогоняется по стадиям до первой `"handled"`.
 */
export function createCommentsComposer(deps: CommentDeps): Composer<Context> {
  const composer = new Composer<Context>();

  const stages: CommentStage[] = [
    createModerationStage(),
    createTriggerStage(),
    createAiReplyStage(),
  ];

  composer
    .chatType(["group", "supergroup"])
    .on("message:text", async (ctx) => {
      // Команды — это не комментарии, пропускаем (их ловят command-хендлеры).
      if (ctx.message.text.startsWith("/")) {
        return;
      }
      // Резолв «своего» канала + гейт принадлежности бота (14b-bis-4) — ОДИН раз
      // на коммент, а не в каждой стадии (аудит 2026-07: было до 6 SELECT'ов).
      // null = «не наш / резолв невозможен» → все стадии молчат, как раньше.
      const channel = await resolveCommentChannel(ctx, deps);
      if (channel === null) {
        return;
      }
      for (const stage of stages) {
        const result = await stage.handle(ctx, deps, channel);
        if (result === "handled") {
          return;
        }
      }
    });

  return composer;
}
