import { Composer, type Context, GrammyError } from "grammy";
import { decodeCb, intArg } from "../../../core/menu/callbackData.js";
import {
  validateAnswer,
  validateChannelTarget,
  validatePostField,
  validateTime,
  validateTriggerWord,
} from "../../../core/menu/validation.js";
import {
  addTime,
  removeTimeAt,
  toggleAutopost,
} from "../../../services/autopostSettings.js";
import {
  publishNow,
  requestApprovalForPost,
  type PostingDeps,
  type PreviewNowResult,
  type PublishNowResult,
} from "../../../services/postingService.js";
import { toggleApproval } from "../../../services/approvalService.js";
import { sendContentEndingNotice } from "../../../services/analyticsService.js";
import { sendWeeklyReportNow } from "../../../services/analytics/weeklyReportService.js";
import {
  addTrigger,
  getActiveChannel,
  removeTrigger,
  setChatId,
} from "../../../db/repositories/channelRepository.js";
import {
  addText,
  getTextPool,
  removeText,
  updateText,
} from "../../../db/repositories/textPoolRepository.js";
import {
  deletePost,
  getButtonPoolMeta,
  getPostDetail,
  updatePostField,
} from "../../../db/repositories/postRepository.js";
import { toggleBooleanSetting } from "../../../db/repositories/settingRepository.js";
import {
  renderAddAnswerPrompt,
  renderAddTriggerPrompt,
  renderAnswer,
  renderEditAnswerPrompt,
  renderAddTimePrompt,
  renderApproval,
  renderAutopost,
  renderMain,
  renderSetChannelPrompt,
  renderSettings,
  renderStatus,
  renderTrigger,
  renderTriggers,
  renderPlan,
  renderPlanWeek,
  renderPlanPost,
  renderEditPostFieldPrompt,
  renderDeletePostConfirm,
  postFieldByCode,
  renderButtonPools,
  renderButtonPool,
  renderButtonAnswer,
  renderAddButtonAnswerPrompt,
  renderEditButtonAnswerPrompt,
  renderButtonPoolByKey,
  buttonPoolKeyAt,
  renderAnalytics,
} from "./screens.js";
import type { AdminDeps, PendingInput, Screen } from "./types.js";

/**
 * Композер меню админа (Шаг 3). Изолированный модуль: правка меню не задевает
 * триггеры/комментарии. Порт `cmd_menu` / `button_handler` Python-бота.
 *
 * Доступ: `/menu` отвечает вежливым отказом не-админу; все callback'и и текстовый
 * ввод обрабатываются только для `adminId`. Режим ожидания ввода (добавить/изменить
 * слово или ответ) держим в in-memory Map — порт `ConversationHandler`.
 */
export function createAdminComposer(deps: AdminDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { adminId } = deps;

  // Состояние «жду текст» по пользователю (один админ, один процесс).
  const pending = new Map<number, PendingInput>();

  // /menu — единственная точка входа. Не-админу — вежливый отказ.
  composer.command("menu", async (ctx) => {
    if (ctx.from?.id !== adminId) {
      await ctx.reply("Команда только для администратора.");
      return;
    }
    pending.delete(adminId);
    await sendScreen(ctx, renderMain());
  });

  // Всё остальное меню — только админ.
  const admin = composer.filter((ctx) => ctx.from?.id === adminId);

  admin.on("callback_query:data", async (ctx, next) => {
    const parsed = decodeCb(ctx.callbackQuery.data);
    if (parsed === null) {
      await next(); // не кнопка меню (напр. `ap:*` одобрения) — отдаём дальше
      return;
    }
    // Любое нажатие кнопки отменяет режим ожидания ввода.
    pending.delete(adminId);
    await routeCallback(ctx, deps, pending, parsed.action, parsed.args);
  });

  // Текстовый ввод в личке — только когда ждём его (иначе отдаём дальше).
  admin.chatType("private").on("message:text", async (ctx, next) => {
    const state = pending.get(adminId);
    if (state === undefined) {
      await next(); // ввод не ждём — пусть его обработает одобрение/комменты
      return;
    }
    const text = ctx.message.text;
    // Команды не считаем вводом (их ловят command-хендлеры).
    if (text.startsWith("/")) {
      await next();
      return;
    }
    await handleInput(ctx, deps, pending, state, text);
  });

  return composer;
}

/** Отправляет экран новым сообщением (после ввода текста). */
async function sendScreen(ctx: Context, screen: Screen): Promise<void> {
  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
}

/**
 * Редактирует текущее сообщение под новый экран. Telegram кидает ошибку, если
 * текст и клавиатура не изменились — её глушим (нажали ту же кнопку повторно).
 */
async function editScreen(ctx: Context, screen: Screen): Promise<void> {
  try {
    await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
  } catch (err) {
    if (
      err instanceof GrammyError &&
      err.description.includes("message is not modified")
    ) {
      return;
    }
    throw err;
  }
}

/** Роутер нажатий кнопок. Действия — короткие коды из callback-data. */
async function routeCallback(
  ctx: Context,
  deps: AdminDeps,
  pending: Map<number, PendingInput>,
  action: string,
  args: readonly string[],
): Promise<void> {
  const adminId = deps.adminId;

  switch (action) {
    case "home":
      await editScreen(ctx, renderMain());
      await ctx.answerCallbackQuery();
      return;

    case "trg":
      await editScreen(ctx, await renderTriggers(deps, intArg(args, 0) ?? 0));
      await ctx.answerCallbackQuery();
      return;

    case "set":
      await editScreen(ctx, await renderSettings(deps));
      await ctx.answerCallbackQuery();
      return;

    case "stat":
      await editScreen(ctx, await renderStatus(deps));
      await ctx.answerCallbackQuery();
      return;

    case "auto":
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery();
      return;

    case "atgl": {
      const channel = await getActiveChannel(deps.prisma);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleAutopost(deps.prisma, channel.id);
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery({
        text: next ? "Автопостинг включён" : "Автопостинг выключен",
      });
      return;
    }

    case "achan":
      pending.set(adminId, { kind: "setChannel" });
      await editScreen(ctx, renderSetChannelPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "atadd":
      pending.set(adminId, { kind: "addTime" });
      await editScreen(ctx, renderAddTimePrompt());
      await ctx.answerCallbackQuery();
      return;

    case "atdel": {
      const idx = intArg(args, 0);
      const channel = await getActiveChannel(deps.prisma);
      if (idx === null || channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await removeTimeAt(deps.prisma, channel.id, idx);
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery({ text: "Время удалено" });
      return;
    }

    case "apub": {
      const postingDeps: PostingDeps = {
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
        pexelsApiKey: deps.pexelsApiKey,
      };
      const result = await publishNow(postingDeps);
      await ctx.answerCallbackQuery({
        text: publishResultText(result),
        show_alert: !result.ok,
      });
      return;
    }

    case "appr":
      await editScreen(ctx, await renderApproval(deps));
      await ctx.answerCallbackQuery();
      return;

    case "aptgl": {
      const channel = await getActiveChannel(deps.prisma);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleApproval(deps.prisma, channel.id);
      await editScreen(ctx, await renderApproval(deps));
      await ctx.answerCallbackQuery({
        text: next ? "Одобрение включено" : "Одобрение выключено",
      });
      return;
    }

    case "ptest": {
      const externalId = intArg(args, 0);
      if (externalId === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const postingDeps: PostingDeps = {
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
        pexelsApiKey: deps.pexelsApiKey,
      };
      const result = await requestApprovalForPost(postingDeps, externalId);
      await ctx.answerCallbackQuery({
        text: previewResultText(result),
        show_alert: !result.ok,
      });
      return;
    }

    case "tw": {
      const wIdx = intArg(args, 0);
      if (wIdx === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderTrigger(deps, wIdx, intArg(args, 1) ?? 0));
      await ctx.answerCallbackQuery();
      return;
    }

    case "ans": {
      const wIdx = intArg(args, 0);
      const aIdx = intArg(args, 1);
      if (wIdx === null || aIdx === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderAnswer(deps, wIdx, aIdx));
      await ctx.answerCallbackQuery();
      return;
    }

    case "addw":
      pending.set(adminId, { kind: "addTrigger" });
      await editScreen(ctx, renderAddTriggerPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "adda": {
      const wIdx = intArg(args, 0);
      const word = wIdx === null ? undefined : await wordAt(deps, wIdx);
      if (wIdx === null || word === undefined) {
        await editScreen(ctx, await renderTriggers(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "addAnswer", word });
      await editScreen(ctx, renderAddAnswerPrompt(word, wIdx));
      await ctx.answerCallbackQuery();
      return;
    }

    case "edita": {
      const wIdx = intArg(args, 0);
      const aIdx = intArg(args, 1);
      const word = wIdx === null ? undefined : await wordAt(deps, wIdx);
      if (wIdx === null || aIdx === null || word === undefined) {
        await editScreen(ctx, await renderTriggers(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      const current = await answerAt(deps, word, aIdx);
      if (current === undefined) {
        await editScreen(ctx, await renderTrigger(deps, wIdx, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "editAnswer", word, index: aIdx });
      await editScreen(ctx, renderEditAnswerPrompt(word, wIdx, aIdx, current));
      await ctx.answerCallbackQuery();
      return;
    }

    case "dela": {
      const wIdx = intArg(args, 0);
      const aIdx = intArg(args, 1);
      const word = wIdx === null ? undefined : await wordAt(deps, wIdx);
      if (wIdx === null || aIdx === null || word === undefined) {
        await editScreen(ctx, await renderTriggers(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      if (channel !== null) {
        await removeText(deps.prisma, channel.id, word, aIdx);
      }
      await editScreen(ctx, await renderTrigger(deps, wIdx, 0));
      await ctx.answerCallbackQuery({ text: "Ответ удалён" });
      return;
    }

    case "delw": {
      const wIdx = intArg(args, 0);
      const word = wIdx === null ? undefined : await wordAt(deps, wIdx);
      if (wIdx === null || word === undefined) {
        await editScreen(ctx, await renderTriggers(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      if (channel !== null) {
        await removeTrigger(deps.prisma, channel.id, word);
        deps.logger.info({ channelId: channel.id, word }, "триггер удалён");
      }
      await editScreen(ctx, await renderTriggers(deps, 0));
      await ctx.answerCallbackQuery({ text: `Триггер «${word}» удалён` });
      return;
    }

    case "tgl": {
      // Сейчас единственный тумблер — comments_enabled.
      if (args[0] !== "comments") {
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleBooleanSetting(
        deps.prisma,
        channel.id,
        "comments_enabled",
        true,
      );
      await editScreen(ctx, await renderSettings(deps));
      await ctx.answerCallbackQuery({
        text: next ? "Ответы в комментах включены" : "Ответы в комментах выключены",
      });
      return;
    }

    case "plan":
      await editScreen(ctx, await renderPlan(deps));
      await ctx.answerCallbackQuery();
      return;

    case "pw": {
      const week = intArg(args, 0);
      if (week === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderPlanWeek(deps, week, intArg(args, 1) ?? 0));
      await ctx.answerCallbackQuery();
      return;
    }

    case "pp": {
      const externalId = intArg(args, 0);
      if (externalId === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderPlanPost(deps, externalId));
      await ctx.answerCallbackQuery();
      return;
    }

    case "ped": {
      const field = postFieldByCode(intArg(args, 0) ?? -1);
      const externalId = intArg(args, 1);
      if (field === undefined || externalId === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      const post =
        channel === null
          ? null
          : await getPostDetail(deps.prisma, channel.id, externalId);
      if (post === null) {
        await editScreen(ctx, await renderPlanPost(deps, externalId));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "editPostField", field, externalId });
      await editScreen(ctx, renderEditPostFieldPrompt(field, externalId, post[field]));
      await ctx.answerCallbackQuery();
      return;
    }

    case "pdc": {
      const externalId = intArg(args, 0);
      if (externalId === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderDeletePostConfirm(deps, externalId));
      await ctx.answerCallbackQuery();
      return;
    }

    case "pdel": {
      const externalId = intArg(args, 0);
      if (externalId === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      let week: number | null = null;
      if (channel !== null) {
        const post = await getPostDetail(deps.prisma, channel.id, externalId);
        week = post?.week ?? null;
        await deletePost(deps.prisma, channel.id, externalId);
        deps.logger.info(
          { channelId: channel.id, externalId },
          "пост контент-плана удалён",
        );
      }
      await editScreen(
        ctx,
        week === null ? await renderPlan(deps) : await renderPlanWeek(deps, week, 0),
      );
      await ctx.answerCallbackQuery({ text: "Пост удалён" });
      return;
    }

    case "bpl":
      await editScreen(ctx, await renderButtonPools(deps));
      await ctx.answerCallbackQuery();
      return;

    case "bpo": {
      const poolIdx = intArg(args, 0);
      if (poolIdx === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderButtonPool(deps, poolIdx, intArg(args, 1) ?? 0));
      await ctx.answerCallbackQuery();
      return;
    }

    case "bia": {
      const poolIdx = intArg(args, 0);
      const ansIdx = intArg(args, 1);
      if (poolIdx === null || ansIdx === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderButtonAnswer(deps, poolIdx, ansIdx));
      await ctx.answerCallbackQuery();
      return;
    }

    case "baa": {
      const poolIdx = intArg(args, 0);
      const key = poolIdx === null ? undefined : await buttonPoolKeyAt(deps, poolIdx);
      if (poolIdx === null || key === undefined) {
        await editScreen(ctx, await renderButtonPools(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "addButtonAnswer", poolKey: key });
      await editScreen(
        ctx,
        renderAddButtonAnswerPrompt(await buttonPoolName(deps, key), poolIdx),
      );
      await ctx.answerCallbackQuery();
      return;
    }

    case "bea": {
      const poolIdx = intArg(args, 0);
      const ansIdx = intArg(args, 1);
      const key = poolIdx === null ? undefined : await buttonPoolKeyAt(deps, poolIdx);
      if (poolIdx === null || ansIdx === null || key === undefined) {
        await editScreen(ctx, await renderButtonPools(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      const current = await answerAt(deps, key, ansIdx);
      if (current === undefined) {
        await editScreen(ctx, await renderButtonPool(deps, poolIdx, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "editButtonAnswer", poolKey: key, index: ansIdx });
      await editScreen(
        ctx,
        renderEditButtonAnswerPrompt(
          await buttonPoolName(deps, key),
          poolIdx,
          ansIdx,
          current,
        ),
      );
      await ctx.answerCallbackQuery();
      return;
    }

    case "bda": {
      const poolIdx = intArg(args, 0);
      const ansIdx = intArg(args, 1);
      const key = poolIdx === null ? undefined : await buttonPoolKeyAt(deps, poolIdx);
      if (poolIdx === null || ansIdx === null || key === undefined) {
        await editScreen(ctx, await renderButtonPools(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      const channel = await getActiveChannel(deps.prisma);
      if (channel !== null) {
        await removeText(deps.prisma, channel.id, key, ansIdx);
      }
      await editScreen(ctx, await renderButtonPool(deps, poolIdx, 0));
      await ctx.answerCallbackQuery({ text: "Ответ удалён" });
      return;
    }

    case "an":
      await editScreen(ctx, await renderAnalytics(deps));
      await ctx.answerCallbackQuery();
      return;

    case "anwarn":
      await sendContentEndingNotice({
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
      });
      await ctx.answerCallbackQuery({
        text: "📨 Напоминание отправлено — проверь сообщение от бота ☝️",
      });
      return;

    case "anrep":
      await ctx.answerCallbackQuery({ text: "Собираю отчёт… ⏳" });
      await sendWeeklyReportNow({
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
        mtproto: deps.mtproto,
      });
      return;

    case "soon":
      await ctx.answerCallbackQuery({ text: "Скоро 🛠" });
      return;

    default:
      await ctx.answerCallbackQuery();
      return;
  }
}

/** Обработка завершённого текстового ввода по режиму ожидания. */
async function handleInput(
  ctx: Context,
  deps: AdminDeps,
  pending: Map<number, PendingInput>,
  state: PendingInput,
  text: string,
): Promise<void> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    pending.delete(deps.adminId);
    await sendScreen(ctx, renderMain());
    return;
  }

  switch (state.kind) {
    case "addTrigger": {
      const result = validateTriggerWord(text, channel.triggerWords);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return; // остаёмся в режиме ввода
      }
      await addTrigger(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      deps.logger.info({ channelId: channel.id, word: result.value }, "триггер добавлен");
      await ctx.reply(`✅ Триггер «${result.value}» добавлен. Теперь добавь ему ответы.`);
      await sendScreen(ctx, await renderTriggers(deps, 0));
      return;
    }

    case "addAnswer": {
      const result = validateAnswer(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      await addText(deps.prisma, channel.id, state.word, result.value);
      pending.delete(deps.adminId);
      await ctx.reply("✅ Ответ добавлен.");
      await sendScreen(ctx, await renderTriggerByWord(deps, state.word));
      return;
    }

    case "editAnswer": {
      const result = validateAnswer(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      const ok = await updateText(
        deps.prisma,
        channel.id,
        state.word,
        state.index,
        result.value,
      );
      pending.delete(deps.adminId);
      await ctx.reply(ok ? "✅ Ответ изменён." : "⚠️ Ответ не найден (возможно, удалён).");
      await sendScreen(ctx, await renderTriggerByWord(deps, state.word));
      return;
    }

    case "addTime": {
      const result = validateTime(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return; // остаёмся в режиме ввода
      }
      await addTime(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      await ctx.reply(`✅ Время добавлено: ${result.value}`);
      await sendScreen(ctx, await renderAutopost(deps));
      return;
    }

    case "setChannel": {
      const result = validateChannelTarget(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return; // остаёмся в режиме ввода
      }
      await setChatId(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      await ctx.reply(
        `✅ Канал публикации: ${result.value}\nУбедись, что бот — админ этого канала.`,
      );
      await sendScreen(ctx, await renderAutopost(deps));
      return;
    }

    case "editPostField": {
      const result = validatePostField(text, state.field);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return; // остаёмся в режиме ввода
      }
      const ok = await updatePostField(
        deps.prisma,
        channel.id,
        state.externalId,
        state.field,
        result.value,
      );
      pending.delete(deps.adminId);
      await ctx.reply(
        ok ? "✅ Пост обновлён." : "⚠️ Пост не найден (возможно, удалён).",
      );
      await sendScreen(ctx, await renderPlanPost(deps, state.externalId));
      return;
    }

    case "addButtonAnswer": {
      const result = validateAnswer(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      await addText(deps.prisma, channel.id, state.poolKey, result.value);
      pending.delete(deps.adminId);
      await ctx.reply("✅ Ответ добавлен.");
      await sendScreen(ctx, await renderButtonPoolByKey(deps, state.poolKey));
      return;
    }

    case "editButtonAnswer": {
      const result = validateAnswer(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      const ok = await updateText(
        deps.prisma,
        channel.id,
        state.poolKey,
        state.index,
        result.value,
      );
      pending.delete(deps.adminId);
      await ctx.reply(ok ? "✅ Ответ изменён." : "⚠️ Ответ не найден (возможно, удалён).");
      await sendScreen(ctx, await renderButtonPoolByKey(deps, state.poolKey));
      return;
    }
  }
}

/** Текст тоста по результату ручной публикации. */
function publishResultText(result: PublishNowResult): string {
  if (result.ok) {
    return `✅ Опубликовано (неделя ${String(result.week)})`;
  }
  switch (result.reason) {
    case "no_channel":
      return "Канал не найден. Запусти сид: npm run seed.";
    case "no_target":
      return "Не задан канал публикации (chatId). Укажите его в настройках канала.";
    case "no_post":
      return "На сегодня нет постов в контент-плане.";
  }
}

/** Текст тоста по результату отправки тестового превью на одобрение. */
function previewResultText(result: PreviewNowResult): string {
  if (result.ok) {
    return "👀 Превью отправлено — проверь сообщение от бота ☝️";
  }
  switch (result.reason) {
    case "no_channel":
      return "Канал не найден. Запусти сид: npm run seed.";
    case "no_post":
      return "Пост не найден (возможно, удалён).";
  }
}

/** Слово-триггер по индексу в актуальном списке канала (или undefined). */
async function wordAt(deps: AdminDeps, wordIdx: number): Promise<string | undefined> {
  const channel = await getActiveChannel(deps.prisma);
  return channel?.triggerWords[wordIdx];
}

/** Текст ответа по слову и индексу (или undefined). */
async function answerAt(
  deps: AdminDeps,
  word: string,
  answerIdx: number,
): Promise<string | undefined> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return undefined;
  }
  const texts = (await getTextPool(deps.prisma, channel.id, word)) ?? [];
  return texts[answerIdx];
}

/** Человекочитаемая подпись пула кнопок: label из поста или сам ключ (доработка 6b). */
async function buttonPoolName(deps: AdminDeps, key: string): Promise<string> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return key;
  }
  const meta = await getButtonPoolMeta(deps.prisma, channel.id);
  return meta.get(key)?.label ?? key;
}

/** Экран триггера, найденного по слову (индекс резолвим из актуального списка). */
async function renderTriggerByWord(deps: AdminDeps, word: string): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return renderMain();
  }
  const idx = channel.triggerWords.indexOf(word);
  if (idx === -1) {
    return renderTriggers(deps, 0);
  }
  return renderTrigger(deps, idx, 0);
}
