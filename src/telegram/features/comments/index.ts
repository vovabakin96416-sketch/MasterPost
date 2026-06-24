import { Composer, type Context } from "grammy";
import { createModerationStage } from "./moderationStage.js";
import { createTriggerStage } from "./triggerStage.js";
import { createAiReplyStage } from "./aiReplyStage.js";
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
      for (const stage of stages) {
        const result = await stage.handle(ctx, deps);
        if (result === "handled") {
          return;
        }
      }
    });

  return composer;
}
