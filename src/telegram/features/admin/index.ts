import { Composer, type Context, GrammyError } from "grammy";
import { decodeCb, intArg } from "../../../core/menu/callbackData.js";
import {
  validateAnswer,
  validateTriggerWord,
} from "../../../core/menu/validation.js";
import {
  addTrigger,
  getActiveChannel,
  removeTrigger,
} from "../../../db/repositories/channelRepository.js";
import {
  addText,
  getTextPool,
  removeText,
  updateText,
} from "../../../db/repositories/textPoolRepository.js";
import { toggleBooleanSetting } from "../../../db/repositories/settingRepository.js";
import {
  renderAddAnswerPrompt,
  renderAddTriggerPrompt,
  renderAnswer,
  renderEditAnswerPrompt,
  renderMain,
  renderSettings,
  renderStatus,
  renderTrigger,
  renderTriggers,
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

  admin.on("callback_query:data", async (ctx) => {
    const parsed = decodeCb(ctx.callbackQuery.data);
    if (parsed === null) {
      await ctx.answerCallbackQuery();
      return;
    }
    // Любое нажатие кнопки отменяет режим ожидания ввода.
    pending.delete(adminId);
    await routeCallback(ctx, deps, pending, parsed.action, parsed.args);
  });

  // Текстовый ввод в личке — только когда ждём его (иначе игнорируем).
  admin.chatType("private").on("message:text", async (ctx) => {
    const state = pending.get(adminId);
    if (state === undefined) {
      return;
    }
    const text = ctx.message.text;
    // Команды не считаем вводом (их ловят command-хендлеры).
    if (text.startsWith("/")) {
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
