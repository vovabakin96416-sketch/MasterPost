import { Composer, type Context, GrammyError } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import {
  decodePostButton,
  type ChoiceCb,
  type PredictionCb,
} from "../../../core/buttons/callback.js";
import { getPostInteractive } from "../../../db/repositories/postRepository.js";
import { getTextPool } from "../../../db/repositories/textPoolRepository.js";
import { pickPredictionNoRepeat } from "../../../core/triggers/pickPrediction.js";
import { isOnCooldown, nextExpiry } from "../../../core/triggers/cooldown.js";
import {
  loadCooldown,
  saveCooldown,
} from "../../../db/repositories/cooldownRepository.js";
import { readCooldownHours } from "../../../services/cooldownSettings.js";

/**
 * Композер кнопок НА ПОСТАХ (Шаг 6b). Изолированный модуль: ловит только наши
 * callback'и `bp:*` на опубликованных постах, остальное отдаёт дальше (`next`).
 * Порт `choice_callback` + `prediction_callback` Python-бота.
 *
 * БЕЗ фильтра по adminId — кнопки жмут любые подписчики канала. `button_choice`
 * отвечает попапом (заготовленный ответ), `button_prediction` шлёт предсказание
 * в личку, переиспользуя машинерию Шага 2 (анти-повтор «колода» + кулдаун 24 ч).
 */
export interface PostButtonsDeps {
  prisma: PrismaClient;
  logger: Logger;
}

/** Лимит текста попап-алерта Telegram (порт `answer[:200]` Python-бота). */
const ALERT_LIMIT = 200;

export function createPostButtonsComposer(deps: PostButtonsDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.on("callback_query:data", async (ctx, next) => {
    const parsed = decodePostButton(ctx.callbackQuery.data);
    if (parsed === null) {
      await next(); // не наша кнопка — пусть ловит другой композер
      return;
    }
    if (parsed.kind === "choice") {
      await handleChoice(ctx, deps, parsed);
    } else {
      await handlePrediction(ctx, deps, parsed);
    }
  });

  return composer;
}

/**
 * `button_choice`: показываем заранее заготовленный ответ варианта попапом
 * (порт `choice_callback`). Ответ берём из исходного `Post.choices` по индексу —
 * он стабилен (правки одобрения текста кнопок не трогают). Без лички и кулдауна.
 */
async function handleChoice(
  ctx: Context,
  deps: PostButtonsDeps,
  cb: ChoiceCb,
): Promise<void> {
  const interactive = await getPostInteractive(deps.prisma, cb.channelId, cb.externalId);
  const choice = interactive?.choices?.[cb.idx];
  if (choice === undefined) {
    await ctx.answerCallbackQuery({ text: "🔮 Скоро раскрою…", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({
    text: choice.answer.slice(0, ALERT_LIMIT),
    show_alert: true,
  });
}

/**
 * `button_prediction`: случайное предсказание из пула `btnType` в личку юзеру
 * (порт `prediction_callback`). Кулдаун и анти-повтор — из таблицы `Cooldown`
 * (как слова-триггеры Шага 2); ключ кулдауна = тип кнопки. Кулдаун ставим только
 * после удачной доставки. Бот не запущен у юзера → подсказываем нажать /start.
 */
async function handlePrediction(
  ctx: Context,
  deps: PostButtonsDeps,
  cb: PredictionCb,
): Promise<void> {
  const from = ctx.from;
  if (from === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }
  const userId = String(from.id);
  const now = new Date();

  const cooldown = await loadCooldown(deps.prisma, cb.channelId, userId, cb.btnType);
  if (cooldown !== null && isOnCooldown(cooldown.expiresAt, now)) {
    await ctx.answerCallbackQuery({
      text: "Уже отправила тебе сегодня — загляни в личку 🌙",
    });
    return;
  }

  const pool = await getTextPool(deps.prisma, cb.channelId, cb.btnType);
  if (pool === null || pool.length === 0) {
    await ctx.answerCallbackQuery({ text: "Скоро пополню 🔮" });
    return;
  }

  const name = from.username ? `@${from.username}` : from.first_name;
  const pick = pickPredictionNoRepeat(pool, cooldown?.recent ?? [], name);
  if (pick === null) {
    await ctx.answerCallbackQuery({ text: "Скоро пополню 🔮" });
    return;
  }

  try {
    await ctx.api.sendMessage(from.id, pick.text);
  } catch (err) {
    if (err instanceof GrammyError) {
      // Чаще всего «bot can't initiate conversation» — юзер не нажимал /start.
      // Текстовый алерт не кликабелен, и люди не понимают, куда писать /start.
      // Открываем чат с ботом напрямую: t.me/<bot>?start — Telegram покажет
      // кнопку «START», один тап и разговор начат.
      const username = ctx.me.username;
      if (username) {
        await ctx.answerCallbackQuery({
          url: `https://t.me/${username}?start=predict`,
        });
      } else {
        await ctx.answerCallbackQuery({
          text: "Открой чат со мной и нажми «Старт» — и получишь ответ в личку! 🔮",
          show_alert: true,
        });
      }
      return;
    }
    throw err;
  }

  const cooldownHours = await readCooldownHours(deps.prisma, cb.channelId);
  await saveCooldown(
    deps.prisma,
    cb.channelId,
    userId,
    cb.btnType,
    nextExpiry(now, cooldownHours),
    pick.recentKeys,
  );
  await ctx.answerCallbackQuery({ text: "Отправила в личку ✨" });
  deps.logger.info(
    { channelId: cb.channelId, userId, btnType: cb.btnType },
    "предсказание по кнопке отправлено в личку",
  );
}
