import { containsTrigger } from "../../../core/triggers/containsTrigger.js";
import { isOnCooldown, nextExpiry } from "../../../core/triggers/cooldown.js";
import { localDateParts } from "../../../core/schedule/localDate.js";
import { resolveCommentChannel } from "./routing.js";
import { getReplyChannelById } from "../../../db/repositories/channelRepository.js";
import {
  loadCooldown,
  saveCooldown,
} from "../../../db/repositories/cooldownRepository.js";
import {
  getAiReplyEnabled,
  getAiTriggerWords,
} from "../../../services/ai/aiReplySettings.js";
import { tryConsumeDailyBudget } from "../../../services/ai/aiBudget.js";
import { generateReply } from "../../../services/ai/aiReplyService.js";
import { readCooldownHours } from "../../../services/cooldownSettings.js";
import type { CommentStage } from "./types.js";

/**
 * Синтетический ключ кулдауна AI-ответа (Шаг 11c). Отдельный от пула триггеров,
 * чтобы AI и готовые тексты не делили счётчик, но час берём из общей настройки
 * кулдауна канала (решение владельца — не плодить лишних настроек).
 */
const AI_REPLY_COOLDOWN_KEY = "__ai_reply";

/**
 * Стадия AI-ответа в комментах (Шаг 11c) — видимая фича на ограждениях 11b.
 *
 * Отвечает по ОТДЕЛЬНОМУ набору AI-триггеров голосом канала (дешёвая модель Haiku),
 * под тройной защитой от расхода: тумблер `ai_reply_enabled` (дефолт ВЫКЛ), пер-юзер
 * кулдаун и дневной бюджет канала. Ворота идут от дешёвых к дорогим — платный вызов
 * Claude только последним, когда всё сошлось. Любой отказ/ошибка → `"pass"` (молчим),
 * стадия стоит последней в конвейере. Без `ANTHROPIC_API_KEY` фича не работает.
 */
export function createAiReplyStage(): CommentStage {
  return {
    name: "ai-reply",
    async handle(ctx, deps) {
      const message = ctx.message;
      const from = ctx.from;
      if (message?.text === undefined || from === undefined) {
        return "pass";
      }
      // Не отвечаем на сообщения ботов/анонимов (GroupAnonymousBot, автопересылка канала).
      if (from.is_bot === true) {
        return "pass";
      }
      const text = message.text;

      // 1. Резолв «своего» канала (общий с триггер-стадией). null → pass.
      const routed = await resolveCommentChannel(ctx, deps);
      if (routed === null) {
        return "pass";
      }
      const channelId = routed.id;

      // 2. Тумблер фичи (дефолт ВЫКЛ) — дешёвая проверка до всего платного.
      const enabled = await getAiReplyEnabled(deps.prisma, channelId);
      if (!enabled) {
        return "pass";
      }

      // 3. Совпадение по отдельному набору AI-триггеров («содержит слово»).
      const aiWords = await getAiTriggerWords(deps.prisma, channelId);
      const matched = containsTrigger(text, aiWords);
      if (matched === null) {
        return "pass";
      }

      // 4. Полные поля канала (тон/ниша/язык/TZ) — фетчим ленивно, раз триггер совпал.
      const channel = await getReplyChannelById(deps.prisma, channelId);
      if (channel === null) {
        return "pass";
      }

      const userId = String(from.id);
      const now = new Date();

      // 5. Пер-юзер кулдаун (синтетический ключ, час — из общей настройки канала).
      const cooldown = await loadCooldown(
        deps.prisma,
        channelId,
        userId,
        AI_REPLY_COOLDOWN_KEY,
      );
      if (cooldown !== null && isOnCooldown(cooldown.expiresAt, now)) {
        return "pass";
      }

      // 6. Дневной бюджет канала (дата дня — в TZ канала). Списываем ДО вызова —
      // жёсткая защита от расхода: исчерпан бюджет / cap=0 → молчим.
      const today = localDateParts(now, channel.timezone).isoDate;
      const withinBudget = await tryConsumeDailyBudget(
        deps.prisma,
        channelId,
        today,
      );
      if (!withinBudget) {
        deps.logger.info({ channelId, userId }, "AI-ответ: дневной бюджет исчерпан");
        return "pass";
      }

      // 7. Платный вызов (последним). Ошибка/пустой ответ → молчим.
      const reply = await generateReply(
        {
          logger: deps.logger,
          apiKey: deps.anthropicApiKey,
          timeoutMs: deps.timeoutMs,
        },
        {
          channelTitle: channel.title,
          niche: channel.niche,
          toneOfVoice: channel.toneOfVoice,
          language: channel.language,
          comment: text,
        },
      );
      if (reply === null) {
        return "pass";
      }

      // Кулдаун ставим ТОЛЬКО когда реально ответили (как в триггер-стадии).
      const cooldownHours = await readCooldownHours(deps.prisma, channelId);
      await saveCooldown(
        deps.prisma,
        channelId,
        userId,
        AI_REPLY_COOLDOWN_KEY,
        nextExpiry(now, cooldownHours),
        cooldown?.recent ?? [],
      );

      await ctx.reply(reply, {
        reply_parameters: { message_id: message.message_id },
      });
      deps.logger.info(
        { channelId, userId, trigger: matched },
        "AI-ответ в комментах",
      );
      return "handled";
    },
  };
}
