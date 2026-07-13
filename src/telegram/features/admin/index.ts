import { Composer, type Context, GrammyError, Keyboard } from "grammy";
import { decodeCb, intArg } from "../../../core/menu/callbackData.js";
import {
  evaluateChannelRights,
  extractRights,
} from "../../../core/onboarding/membership.js";
import {
  validateAnswer,
  validateChannelTarget,
  validateCooldownHours,
  validateDailyCap,
  validateDateTime,
  validatePostField,
  validateTime,
  validateTriggerWord,
} from "../../../core/menu/validation.js";
import {
  addTime,
  removeTimeAt,
  toggleAutopost,
  toggleAiAutopost,
} from "../../../services/autopostSettings.js";
import { setCooldownHours } from "../../../services/cooldownSettings.js";
import {
  requestApprovalForPost,
  type PostingDeps,
  type PreviewNowResult,
} from "../../../services/postingService.js";
import {
  requestAiPostApproval,
  type AiPostApprovalDeps,
  type AiPostApprovalResult,
} from "../../../services/ai/aiPostApprovalService.js";
import { toggleApproval } from "../../../services/approvalService.js";
import {
  addAiTriggerWord,
  getAiTriggerWords,
  removeAiTriggerWord,
  toggleAiReplyEnabled,
} from "../../../services/ai/aiReplySettings.js";
import { setDailyCap } from "../../../services/ai/aiBudget.js";
import { toggleGrowthNarrativeEnabled } from "../../../services/ai/growthNarrativeSettings.js";
import {
  startExperiment,
  stopActiveExperiment,
} from "../../../db/repositories/experimentRepository.js";
import {
  applyExperimentWinner,
  toggleStrategyAutoApply,
  type ApplyResult,
} from "../../../services/experiments/optimizationService.js";
import { EXPERIMENT_DIMENSIONS } from "../../../core/experiments/experiment.js";
import {
  addStopWord,
  getStopWords,
  removeStopWord,
  setToxicityPolicy,
  toggleModerationDelete,
  toggleModerationEnabled,
  toggleToxicityEnabled,
} from "../../../services/moderation/moderationSettings.js";
import { sendContentEndingNotice } from "../../../services/analyticsService.js";
import { sendWeeklyReportNow } from "../../../services/analytics/weeklyReportService.js";
import {
  addTrigger,
  createChannel,
  ensureCampaignStart,
  removeTrigger,
  setChannelActive,
  setChatId,
} from "../../../db/repositories/channelRepository.js";
import {
  resolveChannelMenu,
  resolvePostingChannelSelected,
  resolveSelectedChannel,
  setSelectedChannel,
} from "./channelContext.js";
import {
  addText,
  getTextPool,
  removeText,
  updateText,
} from "../../../db/repositories/textPoolRepository.js";
import {
  createOneOffPost,
  deletePost,
  getButtonPoolMeta,
  getPostDetail,
  updatePostField,
} from "../../../db/repositories/postRepository.js";
import { toggleBooleanSetting } from "../../../db/repositories/settingRepository.js";
import {
  renderAddAnswerPrompt,
  renderAddChannelPrompt,
  renderChannels,
  renderChannelDetail,
  renderRightsCheck,
  renderAddTriggerPrompt,
  renderAnswer,
  renderEditAnswerPrompt,
  renderAddTimePrompt,
  renderApproval,
  renderAutopost,
  renderMain,
  renderSetChannelPrompt,
  renderSetCooldownPrompt,
  renderSettings,
  renderEngagement,
  renderAddAiTriggerPrompt,
  renderSetAiCapPrompt,
  renderModeration,
  renderAddStopWordPrompt,
  renderSetToxicityPolicyPrompt,
  renderStatus,
  renderTrigger,
  renderTriggers,
  renderPlan,
  renderCalendar,
  renderGrowth,
  renderExperiments,
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
  renderNewPostPrompt,
  renderNewPostInteractive,
  newPostInteractiveByCode,
  renderNewPostChoices,
  renderNewPostPools,
  renderNewPostPhoto,
  renderNewPostPreview,
} from "./screens.js";
import type { AdminDeps, NewPostDraft, PendingInput, Screen } from "./types.js";

/** Текст постоянной кнопки, открывающей меню одним нажатием (вместо ввода /menu). */
export const MENU_BUTTON_TEXT = "📋 Меню";

/**
 * Постоянная reply-клавиатура с одной кнопкой «📋 Меню» — висит под полем ввода у
 * админа; нажатие открывает то же, что `/menu`. Ставится один раз (на /start) и держится.
 */
export function buildMenuReplyKeyboard(): Keyboard {
  return new Keyboard().text(MENU_BUTTON_TEXT).resized().persistent();
}

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

  // Черновики мастера «Новый пост» (Шаг 6c) — копятся между шагами, эфемерны.
  const newPostDrafts = new Map<number, NewPostDraft>();

  // /menu — единственная точка входа. Не-админу — вежливый отказ.
  composer.command("menu", async (ctx) => {
    if (ctx.from?.id !== adminId) {
      await ctx.reply("Команда только для администратора.");
      return;
    }
    pending.delete(adminId);
    await sendScreen(ctx, await renderMain(deps));
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
    // Выход из мастера «Новый пост» (кнопка не из мастера) — сбрасываем черновик.
    if (!parsed.action.startsWith("np")) {
      newPostDrafts.delete(adminId);
    }
    await routeCallback(ctx, deps, pending, newPostDrafts, parsed.action, parsed.args);
  });

  // Текстовый ввод в личке — только когда ждём его (иначе отдаём дальше).
  admin.chatType("private").on("message:text", async (ctx, next) => {
    // Нажатие постоянной кнопки «📋 Меню» = открыть меню (как /menu), отменив ввод.
    if (ctx.message.text === MENU_BUTTON_TEXT) {
      pending.delete(adminId);
      newPostDrafts.delete(adminId);
      await sendScreen(ctx, await renderMain(deps));
      return;
    }
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
    await handleInput(ctx, deps, pending, newPostDrafts, state, text);
  });

  // Фото в личке — только когда мастер «Новый пост» ждёт картинку (иначе дальше).
  admin.chatType("private").on("message:photo", async (ctx, next) => {
    if (pending.get(adminId)?.kind !== "npPhotoUp") {
      await next();
      return;
    }
    const draft = newPostDrafts.get(adminId);
    if (draft === undefined) {
      pending.delete(adminId);
      return;
    }
    // Берём самый крупный размер (последний в массиве PhotoSize).
    const sizes = ctx.message.photo;
    const fileId = sizes[sizes.length - 1]?.file_id;
    if (fileId === undefined) {
      await ctx.reply("Не вижу фото — пришли картинку ещё раз.");
      return;
    }
    draft.photoFileId = fileId;
    draft.pexelsQuery = null;
    pending.set(adminId, { kind: "npDateTime" });
    const channel = await resolvePostingChannelSelected(deps);
    await sendScreen(ctx, renderNewPostPrompt(dateTimePromptText(channel?.timezone)));
  });

  return composer;
}

/** Текст шага «когда опубликовать» с поясом канала (Шаг 6c). */
function dateTimePromptText(timezone: string | undefined): string {
  const zone = timezone ?? "пояс канала";
  return (
    "🗓 Когда опубликовать?\n\n" +
    `Пришли дату и время: ДД.ММ ЧЧ:ММ или ДД.ММ.ГГГГ ЧЧ:ММ (пояс ${zone}). ` +
    "Например: 01.07 10:00."
  );
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
  drafts: Map<number, NewPostDraft>,
  action: string,
  args: readonly string[],
): Promise<void> {
  const adminId = deps.adminId;

  switch (action) {
    case "home":
      await editScreen(ctx, await renderMain(deps));
      await ctx.answerCallbackQuery();
      return;

    case "ch":
      await editScreen(ctx, await renderChannels(deps));
      await ctx.answerCallbackQuery();
      return;

    case "chsel": {
      const idx = intArg(args, 0);
      const { channels } = await resolveChannelMenu(deps);
      const channel = idx === null ? undefined : channels[idx];
      if (channel === undefined) {
        await editScreen(ctx, await renderChannels(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      setSelectedChannel(adminId, channel.id);
      deps.logger.info({ channelId: channel.id }, "выбран текущий канал");
      await editScreen(ctx, await renderChannels(deps));
      await ctx.answerCallbackQuery({ text: `Текущий канал: ${channel.title}` });
      return;
    }

    case "chadd":
      pending.set(adminId, { kind: "addChannel" });
      await editScreen(ctx, renderAddChannelPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "chd": {
      const idx = intArg(args, 0);
      if (idx === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await editScreen(ctx, await renderChannelDetail(deps, idx));
      await ctx.answerCallbackQuery();
      return;
    }

    case "chtgt": {
      // Указать цель публикации для канала из карточки: делаем его текущим и ждём ввод
      // (тот же поток `setChannel`, что в «Автопостинге», — пишет в выбранный канал).
      const idx = intArg(args, 0);
      const { channels } = await resolveChannelMenu(deps);
      const channel = idx === null ? undefined : channels[idx];
      if (channel === undefined) {
        await editScreen(ctx, await renderChannels(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      setSelectedChannel(adminId, channel.id);
      pending.set(adminId, { kind: "setChannel" });
      await editScreen(ctx, renderSetChannelPrompt());
      await ctx.answerCallbackQuery();
      return;
    }

    case "chact": {
      const idx = intArg(args, 0);
      const { channels } = await resolveChannelMenu(deps);
      const channel = idx === null ? undefined : channels[idx];
      if (idx === null || channel === undefined) {
        await editScreen(ctx, await renderChannels(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      await setChannelActive(deps.prisma, channel.id, !channel.isActive);
      await editScreen(ctx, await renderChannelDetail(deps, idx));
      await ctx.answerCallbackQuery({
        text: channel.isActive ? "Канал выключен" : "Канал включён",
      });
      return;
    }

    case "chk": {
      // Проверить права бота в канале вживую (Шаг 9a): getChatMember по цели публикации.
      const idx = intArg(args, 0);
      const { channels } = await resolveChannelMenu(deps);
      const channel = idx === null ? undefined : channels[idx];
      if (idx === null || channel === undefined) {
        await editScreen(ctx, await renderChannels(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      if (channel.chatId === null) {
        await ctx.answerCallbackQuery({
          text: "Сначала добавь бота админом в канал или укажи цель публикации.",
          show_alert: true,
        });
        return;
      }
      try {
        const member = await ctx.api.getChatMember(channel.chatId, ctx.me.id);
        const canPostRaw =
          member.status === "administrator"
            ? member.can_post_messages
            : undefined;
        const report = evaluateChannelRights(
          extractRights(member.status, canPostRaw),
        );
        await editScreen(ctx, renderRightsCheck(report, channel.title, idx));
        await ctx.answerCallbackQuery();
      } catch (err) {
        if (err instanceof GrammyError) {
          await editScreen(
            ctx,
            renderRightsCheck(
              {
                summary: "❌ Не удалось проверить: бот не в канале или не админ.",
                missing: ["доступ к каналу"],
              },
              channel.title,
              idx,
            ),
          );
          await ctx.answerCallbackQuery();
          return;
        }
        throw err;
      }
      return;
    }

    case "trg":
      await editScreen(ctx, await renderTriggers(deps, intArg(args, 0) ?? 0));
      await ctx.answerCallbackQuery();
      return;

    case "set":
      await editScreen(ctx, await renderSettings(deps));
      await ctx.answerCallbackQuery();
      return;

    case "cd":
      pending.set(adminId, { kind: "setCooldown" });
      await editScreen(ctx, renderSetCooldownPrompt());
      await ctx.answerCallbackQuery();
      return;

    // Шаг 11c — экран Engagement (AI-ответы в комментах).
    case "eng":
      await editScreen(ctx, await renderEngagement(deps, intArg(args, 0) ?? 0));
      await ctx.answerCallbackQuery();
      return;

    case "engtgl": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleAiReplyEnabled(deps.prisma, channel.id);
      await editScreen(ctx, await renderEngagement(deps, 0));
      await ctx.answerCallbackQuery({
        text: next ? "AI-ответы включены 🤖" : "AI-ответы выключены",
      });
      return;
    }

    case "aiaddw":
      pending.set(adminId, { kind: "addAiTrigger" });
      await editScreen(ctx, renderAddAiTriggerPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "aidelw": {
      const wIdx = intArg(args, 0);
      const page = intArg(args, 1) ?? 0;
      const channel = await resolveSelectedChannel(deps);
      if (wIdx === null || channel === null) {
        await editScreen(ctx, await renderEngagement(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      const words = await getAiTriggerWords(deps.prisma, channel.id);
      const word = words[wIdx];
      if (word === undefined) {
        await editScreen(ctx, await renderEngagement(deps, page));
        await ctx.answerCallbackQuery();
        return;
      }
      await removeAiTriggerWord(deps.prisma, channel.id, word);
      deps.logger.info({ channelId: channel.id, word }, "AI-триггер удалён");
      await editScreen(ctx, await renderEngagement(deps, page));
      await ctx.answerCallbackQuery({ text: `AI-триггер «${word}» удалён` });
      return;
    }

    case "aicap":
      pending.set(adminId, { kind: "setAiCap" });
      await editScreen(ctx, renderSetAiCapPrompt());
      await ctx.answerCallbackQuery();
      return;

    // Шаг 11d — экран модерации комментов (антиспам без AI).
    case "mod":
      await editScreen(ctx, await renderModeration(deps, intArg(args, 0) ?? 0));
      await ctx.answerCallbackQuery();
      return;

    case "modtgl": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleModerationEnabled(deps.prisma, channel.id);
      await editScreen(ctx, await renderModeration(deps, 0));
      await ctx.answerCallbackQuery({
        text: next ? "Модерация включена 🛡" : "Модерация выключена",
      });
      return;
    }

    case "moddel": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleModerationDelete(deps.prisma, channel.id);
      await editScreen(ctx, await renderModeration(deps, 0));
      await ctx.answerCallbackQuery({
        text: next
          ? "Авто-удаление включено 🗑 (нужны права бота)"
          : "Авто-удаление выключено — только сигнал",
      });
      return;
    }

    case "modaddw":
      pending.set(adminId, { kind: "addStopWord" });
      await editScreen(ctx, renderAddStopWordPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "moddelw": {
      const wIdx = intArg(args, 0);
      const page = intArg(args, 1) ?? 0;
      const channel = await resolveSelectedChannel(deps);
      if (wIdx === null || channel === null) {
        await editScreen(ctx, await renderModeration(deps, 0));
        await ctx.answerCallbackQuery();
        return;
      }
      const words = await getStopWords(deps.prisma, channel.id);
      const word = words[wIdx];
      if (word === undefined) {
        await editScreen(ctx, await renderModeration(deps, page));
        await ctx.answerCallbackQuery();
        return;
      }
      await removeStopWord(deps.prisma, channel.id, word);
      deps.logger.info({ channelId: channel.id, word }, "стоп-слово удалено");
      await editScreen(ctx, await renderModeration(deps, page));
      await ctx.answerCallbackQuery({ text: `Стоп-слово «${word}» удалено` });
      return;
    }

    case "toxtgl": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleToxicityEnabled(deps.prisma, channel.id);
      await editScreen(ctx, await renderModeration(deps, 0));
      await ctx.answerCallbackQuery({
        text: next
          ? "Проверка токсичности включена 🧠 (тратит токены)"
          : "Проверка токсичности выключена",
      });
      return;
    }

    case "toxpol":
      pending.set(adminId, { kind: "setToxicityPolicy" });
      await editScreen(ctx, renderSetToxicityPolicyPrompt());
      await ctx.answerCallbackQuery();
      return;

    case "stat":
      await editScreen(ctx, await renderStatus(deps));
      await ctx.answerCallbackQuery();
      return;

    case "aigen": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery({
          text: "Сначала выбери канал в «📡 Каналы».",
          show_alert: true,
        });
        return;
      }
      // Генерация уходит к внешнему API и может занять секунды — отвечаем на
      // callback сразу (иначе Telegram покажет «часики» и таймаут); черновик/ошибка
      // придут отдельным сообщением (превью одобрения шлёт сам сервис).
      await ctx.answerCallbackQuery({ text: "🤖 Генерирую пост… ⏳" });
      const aiDeps: AiPostApprovalDeps = {
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
        pexelsApiKey: deps.pexelsApiKey,
        anthropicApiKey: deps.anthropicApiKey,
        timeoutMs: deps.timeoutMs,
      };
      const result = await requestAiPostApproval(aiDeps, channel.id);
      if (!result.ok) {
        await ctx.api.sendMessage(deps.adminId, aiPostResultText(result));
      }
      return;
    }

    case "auto":
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery();
      return;

    case "atgl": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleAutopost(deps.prisma, channel.id);
      // Шаг 11a: при включении сразу якорим старт плана (если ещё не задан), чтобы
      // недели пошли по порядку и экраны показали верную неделю, не дожидаясь тика.
      if (next) {
        await ensureCampaignStart(deps.prisma, channel.id, new Date());
      }
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery({
        text: next ? "Автопостинг включён" : "Автопостинг выключен",
      });
      return;
    }

    case "aitgl": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleAiAutopost(deps.prisma, channel.id);
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery({
        text: next ? "AI-подхват включён 🤖" : "AI-подхват выключен",
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
      const channel = await resolveSelectedChannel(deps);
      if (idx === null || channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      await removeTimeAt(deps.prisma, channel.id, idx);
      await editScreen(ctx, await renderAutopost(deps));
      await ctx.answerCallbackQuery({ text: "Время удалено" });
      return;
    }

    case "appr":
      await editScreen(ctx, await renderApproval(deps));
      await ctx.answerCallbackQuery();
      return;

    case "aptgl": {
      const channel = await resolveSelectedChannel(deps);
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
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery({ text: "Канал не найден.", show_alert: true });
        return;
      }
      const postingDeps: PostingDeps = {
        prisma: deps.prisma,
        logger: deps.logger,
        api: ctx.api,
        adminId: deps.adminId,
        pexelsApiKey: deps.pexelsApiKey,
        anthropicApiKey: deps.anthropicApiKey,
        timeoutMs: deps.timeoutMs,
      };
      const result = await requestApprovalForPost(postingDeps, channel.id, externalId);
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
      const channel = await resolveSelectedChannel(deps);
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
      const channel = await resolveSelectedChannel(deps);
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
      const channel = await resolveSelectedChannel(deps);
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

    case "cal":
      await editScreen(ctx, await renderCalendar(deps));
      await ctx.answerCallbackQuery();
      return;

    case "grow":
      await ctx.answerCallbackQuery({ text: "Считаю выводы… ⏳" });
      await editScreen(ctx, await renderGrowth(deps));
      return;

    // Шаг 12d: тумблер AI-пересказа роста. При включении экран сразу перерисуется
    // уже с пересказом (платный вызов Haiku — потому тост предупреждает про токены).
    case "gntgl": {
      const channel = await resolvePostingChannelSelected(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleGrowthNarrativeEnabled(deps.prisma, channel.id);
      await ctx.answerCallbackQuery({
        text: next
          ? "AI-пересказ включён 🧠 (тратит токены) — пересказываю… ⏳"
          : "AI-пересказ выключен — сухие выводы",
      });
      await editScreen(ctx, await renderGrowth(deps));
      return;
    }

    // Шаг 13d — экран «🧪 Эксперименты»: прогресс активного A/B либо запуск измерения.
    case "exp":
      await editScreen(ctx, await renderExperiments(deps));
      await ctx.answerCallbackQuery();
      return;

    case "xstart": {
      const idx = intArg(args, 0);
      const channel = await resolveSelectedChannel(deps);
      const dim = idx === null ? undefined : EXPERIMENT_DIMENSIONS[idx];
      if (channel === null || dim === undefined) {
        await editScreen(ctx, await renderExperiments(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      await startExperiment(deps.prisma, channel.id, dim.dimension);
      deps.logger.info(
        { channelId: channel.id, dimension: dim.dimension },
        "эксперимент запущен",
      );
      await editScreen(ctx, await renderExperiments(deps));
      await ctx.answerCallbackQuery({ text: `Эксперимент «${dim.label}» запущен 🧪` });
      return;
    }

    case "xstop": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const stopped = await stopActiveExperiment(deps.prisma, channel.id);
      await editScreen(ctx, await renderExperiments(deps));
      await ctx.answerCallbackQuery({
        text: stopped > 0 ? "Эксперимент остановлен" : "Активных экспериментов нет",
      });
      return;
    }

    // Шаг 13e — применить победителя эксперимента в выученную стратегию канала.
    case "xapply": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const result = await applyExperimentWinner(deps.prisma, channel.id, new Date());
      await editScreen(ctx, await renderExperiments(deps));
      await ctx.answerCallbackQuery({ text: applyWinnerToast(result) });
      return;
    }

    // Шаг 13e — тумблер авто-применения победителя (дефолт ВЫКЛ).
    case "xauto": {
      const channel = await resolveSelectedChannel(deps);
      if (channel === null) {
        await ctx.answerCallbackQuery();
        return;
      }
      const next = await toggleStrategyAutoApply(deps.prisma, channel.id);
      await editScreen(ctx, await renderExperiments(deps));
      await ctx.answerCallbackQuery({
        text: next
          ? "Авто-применение включено 🔁 (победитель применится сам в ПН-обзоре)"
          : "Авто-применение выключено — победителя применяй кнопкой",
      });
      return;
    }

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
      const channel = await resolveSelectedChannel(deps);
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
      const channel = await resolveSelectedChannel(deps);
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

    // ─── Мастер «Новый пост» (разовый, Шаг 6c) ───────────────────────────────
    case "np": {
      drafts.set(adminId, { choices: [], pexelsQuery: null, photoFileId: null });
      pending.set(adminId, { kind: "npTitle" });
      await editScreen(
        ctx,
        renderNewPostPrompt("📝 Новый разовый пост.\n\nПришли заголовок поста."),
      );
      await ctx.answerCallbackQuery();
      return;
    }

    case "npit": {
      const code = intArg(args, 0);
      const type = code === null ? undefined : newPostInteractiveByCode(code);
      const draft = drafts.get(adminId);
      if (type === undefined || draft === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      draft.interactiveType = type;
      if (type === "button_choice") {
        pending.set(adminId, { kind: "npChoice" });
        await editScreen(ctx, renderNewPostChoices(draft));
      } else if (type === "button_prediction") {
        pending.delete(adminId);
        await editScreen(ctx, await renderNewPostPools(deps));
      } else {
        // keyword_trigger / vote_123 — кнопок под постом нет, сразу к фото.
        pending.delete(adminId);
        await editScreen(ctx, renderNewPostPhoto());
      }
      await ctx.answerCallbackQuery();
      return;
    }

    case "npcd": {
      const draft = drafts.get(adminId);
      if (draft === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (draft.choices.length === 0) {
        await ctx.answerCallbackQuery({ text: "Добавь хотя бы один вариант." });
        return;
      }
      pending.delete(adminId);
      await editScreen(ctx, renderNewPostPhoto());
      await ctx.answerCallbackQuery();
      return;
    }

    case "nppl": {
      const idx = intArg(args, 0);
      const draft = drafts.get(adminId);
      if (idx === null || draft === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      const key = await buttonPoolKeyAt(deps, idx);
      if (key === undefined) {
        await editScreen(ctx, await renderNewPostPools(deps));
        await ctx.answerCallbackQuery();
        return;
      }
      pending.set(adminId, { kind: "npBtnLabel", poolKey: key });
      await editScreen(
        ctx,
        renderNewPostPrompt(
          `🔮 Пул «${key}» выбран.\n\nПришли подпись для кнопки (что увидит подписчик).`,
        ),
      );
      await ctx.answerCallbackQuery();
      return;
    }

    case "npph": {
      const code = intArg(args, 0);
      const draft = drafts.get(adminId);
      if (code === null || draft === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (code === 0) {
        pending.set(adminId, { kind: "npPexels" });
        await editScreen(
          ctx,
          renderNewPostPrompt(
            "🔎 Пришли запрос для подбора фото в Pexels (например: tarot cards candles).",
          ),
        );
      } else if (code === 1) {
        pending.set(adminId, { kind: "npPhotoUp" });
        await editScreen(
          ctx,
          renderNewPostPrompt("📤 Пришли фото одним сообщением (как картинку)."),
        );
      } else {
        draft.pexelsQuery = null;
        draft.photoFileId = null;
        pending.set(adminId, { kind: "npDateTime" });
        const channel = await resolvePostingChannelSelected(deps);
        await editScreen(ctx, renderNewPostPrompt(dateTimePromptText(channel?.timezone)));
      }
      await ctx.answerCallbackQuery();
      return;
    }

    case "npsave": {
      const draft = drafts.get(adminId);
      const channel = await resolvePostingChannelSelected(deps);
      if (
        draft === undefined ||
        channel === null ||
        draft.title === undefined ||
        draft.text === undefined ||
        draft.cta === undefined ||
        draft.interactiveType === undefined ||
        draft.publishAt === undefined
      ) {
        drafts.delete(adminId);
        pending.delete(adminId);
        await editScreen(ctx, await renderPlan(deps));
        await ctx.answerCallbackQuery({ text: "Черновик неполон — начни заново." });
        return;
      }
      const externalId = await createOneOffPost(deps.prisma, channel.id, {
        title: draft.title,
        text: draft.text,
        cta: draft.cta,
        interactiveType: draft.interactiveType,
        choices: draft.interactiveType === "button_choice" ? draft.choices : null,
        button: draft.button ?? null,
        pexelsQuery: draft.pexelsQuery,
        photoFileId: draft.photoFileId,
        publishAt: draft.publishAt,
      });
      drafts.delete(adminId);
      pending.delete(adminId);
      deps.logger.info(
        { channelId: channel.id, externalId, publishAt: draft.publishAt.toISOString() },
        "разовый пост запланирован",
      );
      await editScreen(ctx, await renderPlan(deps));
      await ctx.answerCallbackQuery({ text: "✅ Запланировано" });
      return;
    }

    case "npx": {
      drafts.delete(adminId);
      pending.delete(adminId);
      await editScreen(ctx, await renderPlan(deps));
      await ctx.answerCallbackQuery({ text: "Отменено" });
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
      const channel = await resolveSelectedChannel(deps);
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
        anthropicApiKey: deps.anthropicApiKey,
        timeoutMs: deps.timeoutMs,
        telemetrApiKey: deps.telemetrApiKey,
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
  drafts: Map<number, NewPostDraft>,
  state: PendingInput,
  text: string,
): Promise<void> {
  // Создание канала не требует существующего канала (это может быть самый первый) —
  // обрабатываем до проверки на наличие текущего канала.
  if (state.kind === "addChannel") {
    const title = text.trim();
    if (title.length === 0 || title.length > 100) {
      await ctx.reply("⚠️ Название канала: 1–100 символов. Попробуй ещё раз.");
      return; // остаёмся в режиме ввода
    }
    const id = await createChannel(deps.prisma, { title });
    setSelectedChannel(deps.adminId, id);
    pending.delete(deps.adminId);
    deps.logger.info({ channelId: id, title }, "канал создан и выбран текущим");
    await ctx.reply(
      `✅ Канал «${title}» создан и стал текущим.\nЗаполни его в разделах меню: триггеры, контент-план, цель публикации.`,
    );
    await sendScreen(ctx, await renderChannels(deps));
    return;
  }

  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    pending.delete(deps.adminId);
    await sendScreen(ctx, await renderMain(deps));
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

    case "setCooldown": {
      const result = validateCooldownHours(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return; // остаёмся в режиме ввода
      }
      await setCooldownHours(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      await ctx.reply(
        result.value === 0
          ? "✅ Кулдаун отключён."
          : `✅ Кулдаун: ${String(result.value)} ч.`,
      );
      await sendScreen(ctx, await renderSettings(deps));
      return;
    }

    case "addAiTrigger": {
      const existing = await getAiTriggerWords(deps.prisma, channel.id);
      const result = validateTriggerWord(text, existing);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return; // остаёмся в режиме ввода
      }
      await addAiTriggerWord(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      deps.logger.info(
        { channelId: channel.id, word: result.value },
        "AI-триггер добавлен",
      );
      await ctx.reply(`✅ AI-триггер «${result.value}» добавлен.`);
      await sendScreen(ctx, await renderEngagement(deps, 0));
      return;
    }

    case "addStopWord": {
      const existing = await getStopWords(deps.prisma, channel.id);
      const result = validateTriggerWord(text, existing);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return; // остаёмся в режиме ввода
      }
      await addStopWord(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      deps.logger.info(
        { channelId: channel.id, word: result.value },
        "стоп-слово добавлено",
      );
      await ctx.reply(`✅ Стоп-слово «${result.value}» добавлено.`);
      await sendScreen(ctx, await renderModeration(deps, 0));
      return;
    }

    case "setToxicityPolicy": {
      const trimmed = text.trim();
      // «-» или пусто → сброс на авто-оценку по нише.
      const reset = trimmed === "" || trimmed === "-";
      const policy = reset ? "" : trimmed.slice(0, 500);
      await setToxicityPolicy(deps.prisma, channel.id, policy);
      pending.delete(deps.adminId);
      await ctx.reply(
        reset
          ? "✅ Политика токсичности сброшена на авто по нише."
          : "✅ Политика токсичности обновлена.",
      );
      await sendScreen(ctx, await renderModeration(deps, 0));
      return;
    }

    case "setAiCap": {
      const result = validateDailyCap(text);
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return; // остаёмся в режиме ввода
      }
      await setDailyCap(deps.prisma, channel.id, result.value);
      pending.delete(deps.adminId);
      await ctx.reply(
        result.value === 0
          ? "✅ Платные AI-вызовы отключены (лимит 0)."
          : `✅ Дневной лимит AI-вызовов: ${String(result.value)}.`,
      );
      await sendScreen(ctx, await renderEngagement(deps, 0));
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

    // ─── Мастер «Новый пост» (текстовые шаги, Шаг 6c) ────────────────────────
    case "npTitle": {
      const result = validatePostField(text, "title");
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.title = result.value;
      pending.set(deps.adminId, { kind: "npText" });
      await sendScreen(
        ctx,
        renderNewPostPrompt("Заголовок принят. Пришли основной текст поста."),
      );
      return;
    }

    case "npText": {
      const result = validatePostField(text, "text");
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.text = result.value;
      pending.set(deps.adminId, { kind: "npCta" });
      await sendScreen(ctx, renderNewPostPrompt("Текст принят. Пришли призыв к действию (CTA)."));
      return;
    }

    case "npCta": {
      const result = validatePostField(text, "cta");
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}\nПопробуй ещё раз.`);
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.cta = result.value;
      pending.delete(deps.adminId);
      await sendScreen(ctx, renderNewPostInteractive());
      return;
    }

    case "npChoice": {
      const sep = text.indexOf("|");
      if (sep === -1) {
        await ctx.reply("⚠️ Формат: «метка | ответ». Попробуй ещё раз.");
        return;
      }
      const label = text.slice(0, sep).trim();
      if (label.length === 0 || label.length > 60) {
        await ctx.reply("⚠️ Метка кнопки: 1–60 символов.");
        return;
      }
      const answer = validateAnswer(text.slice(sep + 1));
      if (!answer.ok) {
        await ctx.reply(`⚠️ ${answer.error}`);
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.choices.push({ label, answer: answer.value });
      await sendScreen(ctx, renderNewPostChoices(draft)); // остаёмся в цикле
      return;
    }

    case "npBtnLabel": {
      const label = text.trim();
      if (label.length === 0 || label.length > 60) {
        await ctx.reply("⚠️ Подпись кнопки: 1–60 символов.");
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.button = { type: state.poolKey, label };
      pending.delete(deps.adminId);
      await sendScreen(ctx, renderNewPostPhoto());
      return;
    }

    case "npPexels": {
      const query = text.trim();
      if (query.length === 0 || query.length > 100) {
        await ctx.reply("⚠️ Запрос для фото: 1–100 символов.");
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.pexelsQuery = query;
      draft.photoFileId = null;
      pending.set(deps.adminId, { kind: "npDateTime" });
      const posting = await resolvePostingChannelSelected(deps);
      await sendScreen(ctx, renderNewPostPrompt(dateTimePromptText(posting?.timezone)));
      return;
    }

    case "npPhotoUp": {
      // Фото ждём картинкой (ловит message:photo). Текст на этом шаге — подсказка.
      await ctx.reply("Пришли фото картинкой (не текстом) или нажми «Отмена».");
      return;
    }

    case "npDateTime": {
      const posting = await resolvePostingChannelSelected(deps);
      if (posting === null) {
        pending.delete(deps.adminId);
        drafts.delete(deps.adminId);
        await sendScreen(ctx, await renderMain(deps));
        return;
      }
      const result = validateDateTime(text, posting.timezone, new Date());
      if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return;
      }
      const draft = drafts.get(deps.adminId);
      if (draft === undefined) {
        pending.delete(deps.adminId);
        return;
      }
      draft.publishAt = result.value;
      pending.delete(deps.adminId);
      await sendScreen(ctx, renderNewPostPreview(draft, posting.timezone));
      return;
    }
  }
}

/** Сообщение админу при неудаче генерации AI-поста (Шаг 10b). */
function aiPostResultText(result: Extract<AiPostApprovalResult, { ok: false }>): string {
  switch (result.reason) {
    case "no_key":
      return (
        "🤖 AI-генерация выключена: не задан ANTHROPIC_API_KEY.\n" +
        "Добавь ключ Anthropic в переменные окружения (Railway) и перезапусти бота."
      );
    case "no_channel":
      return "Канал не найден (возможно, удалён). Открой «📡 Каналы».";
    case "no_samples":
      return "У канала нет постов-образцов — заполни контент-план, чтобы AI перенял его стиль.";
    case "gen_failed":
      return "Не удалось сгенерировать пост (модель не ответила или вернула мусор). Попробуй ещё раз чуть позже.";
  }
}

/** Тост по результату применения победителя эксперимента (Шаг 13e). */
function applyWinnerToast(result: ApplyResult): string {
  switch (result.status) {
    case "applied":
      return `Победитель «${result.variantLabel}» применён ✅ (${result.dimensionLabel})`;
    case "suspicious":
      return "Подписчики за период падали — победитель под подозрением, не применён";
    case "not_ready":
      return "Победитель ещё не определён — копим данные";
    case "no_experiment":
      return "Активных экспериментов нет";
    case "auto_off":
      return "Авто-применение выключено";
  }
}

/** Текст тоста по результату отправки тестового превью на одобрение. */
function previewResultText(result: PreviewNowResult): string {
  if (result.ok) {
    return "👀 Превью отправлено — проверь сообщение от бота ☝️";
  }
  switch (result.reason) {
    case "no_channel":
      return "Канал не найден (возможно, удалён). Открой «📡 Каналы».";
    case "no_post":
      return "Пост не найден (возможно, удалён).";
  }
}

/** Слово-триггер по индексу в актуальном списке канала (или undefined). */
async function wordAt(deps: AdminDeps, wordIdx: number): Promise<string | undefined> {
  const channel = await resolveSelectedChannel(deps);
  return channel?.triggerWords[wordIdx];
}

/** Текст ответа по слову и индексу (или undefined). */
async function answerAt(
  deps: AdminDeps,
  word: string,
  answerIdx: number,
): Promise<string | undefined> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return undefined;
  }
  const texts = (await getTextPool(deps.prisma, channel.id, word)) ?? [];
  return texts[answerIdx];
}

/** Человекочитаемая подпись пула кнопок: label из поста или сам ключ (доработка 6b). */
async function buttonPoolName(deps: AdminDeps, key: string): Promise<string> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return key;
  }
  const meta = await getButtonPoolMeta(deps.prisma, channel.id);
  return meta.get(key)?.label ?? key;
}

/** Экран триггера, найденного по слову (индекс резолвим из актуального списка). */
async function renderTriggerByWord(deps: AdminDeps, word: string): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return await renderMain(deps);
  }
  const idx = channel.triggerWords.indexOf(word);
  if (idx === -1) {
    return renderTriggers(deps, 0);
  }
  return renderTrigger(deps, idx, 0);
}
