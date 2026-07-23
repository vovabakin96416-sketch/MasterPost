import { matchTrigger } from "../../../core/triggers/matchTrigger.js";
import {
  pickPredictionNoRepeat,
  renderAnonymous,
  renderTemplate,
} from "../../../core/triggers/pickPrediction.js";
import { isOnCooldown, nextExpiry } from "../../../core/triggers/cooldown.js";
import { getTextPool } from "../../../db/repositories/textPoolRepository.js";
import {
  loadCooldown,
  saveCooldown,
} from "../../../db/repositories/cooldownRepository.js";
import { getBooleanSetting } from "../../../db/repositories/settingRepository.js";
import { readCooldownHours } from "../../../services/cooldownSettings.js";
import type { CommentStage } from "./types.js";

/**
 * Алиасы слов-триггеров на ключ пула. «да»/«нет» — это оракул: оба слова тянут
 * из общего пула «оракул» и делят один кулдаун (как `oracle` в Python-боте).
 * Для остальных слов ключ пула = само слово (карта/кофе/руна/…).
 */
const TRIGGER_ALIASES: Record<string, string> = {
  да: "оракул",
  нет: "оракул",
};

/**
 * Реальная логика триггеров в комментах (порт `handle_message` Python-бота).
 *
 * Поток: канал (резолвнут композером) → проверка `comments_enabled` → совпадение
 * слова из `Channel.triggerWords` → пул `TextPool` по совпавшему слову →
 * кулдаун → случайное предсказание с подстановкой `{name}` → ответ.
 * Вся тематика — в данных канала; код общий для любой ниши.
 */
export function createTriggerStage(): CommentStage {
  return {
    name: "trigger",
    async handle(ctx, deps, channel) {
      const message = ctx.message;
      const from = ctx.from;
      if (message === undefined || from === undefined) {
        return "pass";
      }
      const text = message.text;
      if (text === undefined) {
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

      // Ключ пула = совпавшее слово, либо его алиас (да/нет → «оракул»). Один и
      // тот же ключ служит и пулом текстов, и ключом кулдауна.
      const triggerKey = TRIGGER_ALIASES[matched] ?? matched;
      const pool = await getTextPool(deps.prisma, channel.id, triggerKey);
      if (pool === null || pool.length === 0) {
        return "pass";
      }

      const userId = String(from.id);
      const now = new Date();
      const cooldown = await loadCooldown(
        deps.prisma,
        channel.id,
        userId,
        triggerKey,
      );
      if (cooldown !== null && isOnCooldown(cooldown.expiresAt, now)) {
        // Слово распознано, но на кулдауне — молчим и дальше не пускаем.
        return "handled";
      }

      // Аноним (`GroupAnonymousBot`, is_bot) — комментарий от имени канала/группы:
      // не обращаемся по @username бота, а даём нейтральный префикс «Лови послание».
      const anon = from.is_bot === true;
      const name = from.username ? `@${from.username}` : from.first_name;
      const render = anon
        ? (t: string): string => renderAnonymous(t)
        : (t: string, n: string): string => renderTemplate(t, { name: n });
      // Анти-повтор «колода»: память недавно показанных ответов — в строке кулдауна.
      const pick = pickPredictionNoRepeat(
        pool,
        cooldown?.recent ?? [],
        name,
        Math.random,
        render,
      );
      if (pick === null) {
        return "pass";
      }

      // Кулдаун потребляем только когда реально отвечаем (как в Python).
      const cooldownHours = await readCooldownHours(deps.prisma, channel.id);
      await saveCooldown(
        deps.prisma,
        channel.id,
        userId,
        triggerKey,
        nextExpiry(now, cooldownHours),
        pick.recentKeys,
      );

      await ctx.reply(pick.text, {
        reply_parameters: { message_id: message.message_id },
      });
      deps.logger.info(
        { channelId: channel.id, userId, trigger: matched, pool: triggerKey },
        "ответ на триггер",
      );
      return "handled";
    },
  };
}
