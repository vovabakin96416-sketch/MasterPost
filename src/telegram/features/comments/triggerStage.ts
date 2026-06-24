import { matchTrigger } from "../../../core/triggers/matchTrigger.js";
import { pickPrediction } from "../../../core/triggers/pickPrediction.js";
import { getActiveChannel } from "../../../db/repositories/channelRepository.js";
import { getTextPool } from "../../../db/repositories/textPoolRepository.js";
import { tryConsumeCooldown } from "../../../db/repositories/cooldownRepository.js";
import { getBooleanSetting } from "../../../db/repositories/settingRepository.js";
import type { CommentStage } from "./types.js";

/** Кулдаун на (канал, пользователь, слово), часов. Как COOLDOWN_HOURS в Python. */
const COOLDOWN_HOURS = 24;

/**
 * Реальная логика триггеров в комментах (порт `handle_message` Python-бота).
 *
 * Поток: резолв активного канала → проверка `comments_enabled` → совпадение
 * слова из `Channel.triggerWords` → пул `TextPool` по совпавшему слову →
 * кулдаун → случайное предсказание с подстановкой `{name}` → ответ.
 * Вся тематика — в данных канала; код общий для любой ниши.
 */
export function createTriggerStage(): CommentStage {
  return {
    name: "trigger",
    async handle(ctx, deps) {
      const message = ctx.message;
      const from = ctx.from;
      if (message === undefined || from === undefined) {
        return "pass";
      }
      const text = message.text;
      if (text === undefined) {
        return "pass";
      }

      const channel = await getActiveChannel(deps.prisma);
      if (channel === null) {
        return "pass";
      }

      const enabled = await getBooleanSetting(
        deps.prisma,
        channel.id,
        "comments_enabled",
        true,
      );
      if (!enabled) {
        return "pass";
      }

      const matched = matchTrigger(text, channel.triggerWords);
      if (matched === null) {
        return "pass";
      }

      // Ключ пула = совпавшее слово-триггер (карта/кофе/руна для канала №1).
      const pool = await getTextPool(deps.prisma, channel.id, matched);
      if (pool === null || pool.length === 0) {
        return "pass";
      }

      const userId = String(from.id);
      // Кулдаун потребляем только когда реально готовы ответить (как в Python).
      const allowed = await tryConsumeCooldown(
        deps.prisma,
        channel.id,
        userId,
        matched,
        COOLDOWN_HOURS,
      );
      if (!allowed) {
        // Слово распознано, но на кулдауне — молчим и дальше не пускаем.
        return "handled";
      }

      const name = from.username ? `@${from.username}` : from.first_name;
      const prediction = pickPrediction(pool, name);
      if (prediction === null) {
        return "pass";
      }

      await ctx.reply(prediction, {
        reply_parameters: { message_id: message.message_id },
      });
      deps.logger.info(
        { channelId: channel.id, userId, trigger: matched },
        "ответ на триггер",
      );
      return "handled";
    },
  };
}
