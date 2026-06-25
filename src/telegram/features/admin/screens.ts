import { encodeCb } from "../../../core/menu/callbackData.js";
import { paginate } from "../../../core/menu/paginate.js";
import { poolHealth, poolAgeDays } from "../../../core/content/poolHealth.js";
import {
  getActiveChannel,
  getChannelDisplay,
  getPostingChannel,
} from "../../../db/repositories/channelRepository.js";
import { readAutopostConfig } from "../../../services/autopostSettings.js";
import { isApprovalEnabled } from "../../../services/approvalService.js";
import { countPending } from "../../../db/repositories/pendingPostRepository.js";
import { localDateParts } from "../../../core/schedule/localDate.js";
import { resolveCampaignDay } from "../../../core/schedule/resolveCampaignDay.js";
import {
  getTextPoolDetail,
  listTriggerSummaries,
} from "../../../db/repositories/textPoolRepository.js";
import { getBooleanSetting } from "../../../db/repositories/settingRepository.js";
import { buildKeyboard, navRow, pageRow, preview, type Btn } from "./keyboard.js";
import type { AdminDeps, Screen } from "./types.js";

/**
 * Рендереры экранов меню. Каждый возвращает `Screen` (текст + клавиатура).
 * Тематики в коде нет — слова/ответы/настройки берутся из данных канала.
 *
 * Навигация и пагинация — через хелперы `keyboard.ts`; callback-data — через
 * `core/menu/callbackData`. Новый раздел добавляется записью в `MAIN_SECTIONS`
 * плюс своим рендерером и веткой роутера.
 */

/** Кулдаун триггеров, часов (read-only в меню; синхронно с triggerStage). */
const COOLDOWN_HOURS = 24;

/** Сколько триггеров/ответов показываем на одной странице списка. */
const PAGE_TRIGGERS = 8;
const PAGE_ANSWERS = 6;

/** Ключ настройки «отвечать в комментах» (как в Шаге 2). */
const COMMENTS_KEY = "comments_enabled";

/** Русское склонение «ответ / ответа / ответов». */
function pluralAnswers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "ответ";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "ответа";
  }
  return "ответов";
}

/** Русское склонение «день / дня / дней». */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "день";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "дня";
  }
  return "дней";
}

/**
 * Раздел главного меню. `soon: true` — задел под будущие функции (Шаги 4/5/11):
 * кнопка видна, но ведёт на заглушку-тост. Новый раздел = одна запись здесь.
 */
interface Section {
  readonly label: string;
  readonly data: string;
}

export const MAIN_SECTIONS: readonly Section[] = [
  { label: "💬 Триггеры", data: encodeCb("trg", 0) },
  { label: "⚙️ Настройки", data: encodeCb("set") },
  { label: "📊 Статус", data: encodeCb("stat") },
  { label: "📅 Автопостинг", data: encodeCb("auto") },
  { label: "📋 Одобрение постов", data: encodeCb("appr") },
  { label: "⏳ AI-ответы (скоро)", data: encodeCb("soon") },
];

/** Дни недели по-русски для экрана автопостинга. */
const DAY_RU: Record<string, string> = {
  monday: "понедельник",
  tuesday: "вторник",
  wednesday: "среда",
  thursday: "четверг",
  friday: "пятница",
  saturday: "суббота",
  sunday: "воскресенье",
};

/** Экран-заглушка, когда активного канала нет (не запущен сид). */
function noChannelScreen(): Screen {
  return {
    text: "Активный канал не найден. Запусти сид: `npm run seed`.",
    keyboard: buildKeyboard([navRow()]),
  };
}

/** Экран 1 — главное меню. */
export function renderMain(): Screen {
  const rows = MAIN_SECTIONS.map((s): Btn[] => [{ label: s.label, data: s.data }]);
  return {
    text: "🤖 Меню управления каналом\n\nВыбери раздел:",
    keyboard: buildKeyboard(rows),
  };
}

/** Экран 2 — список слов-триггеров со счётчиком ответов. */
export async function renderTriggers(
  deps: AdminDeps,
  page: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const summaries = await listTriggerSummaries(
    deps.prisma,
    channel.id,
    channel.triggerWords,
  );
  const pg = paginate(summaries, page, PAGE_TRIGGERS);
  const now = new Date();

  const rows: Btn[][] = pg.slice.map((item, i) => {
    const globalIdx = pg.page * PAGE_TRIGGERS + i;
    // ⚠️ — пул мал или застоялся: владельцу видно, что пора освежить.
    const warn = poolHealth(item.count, item.updatedAt, now).stale ? " ⚠️" : "";
    return [
      {
        label: `${item.word} · ${String(item.count)} ${pluralAnswers(item.count)}${warn} ›`,
        data: encodeCb("tw", globalIdx, 0),
      },
    ];
  });
  rows.push([{ label: "➕ Добавить триггер", data: encodeCb("addw") }]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (p) =>
    encodeCb("trg", p),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow());

  const header =
    summaries.length === 0
      ? "💬 Триггеры\n\nПока нет ни одного слова. Добавь первое."
      : `💬 Триггеры (${String(summaries.length)})\n\nСлова, на которые бот отвечает в комментах. Нажми слово, чтобы открыть ответы.`;
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран 3 — один триггер: его ответы + действия. */
export async function renderTrigger(
  deps: AdminDeps,
  wordIdx: number,
  page: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const word = channel.triggerWords[wordIdx];
  if (word === undefined) {
    return {
      text: "Триггер не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("trg", 0))]),
    };
  }
  const detail = await getTextPoolDetail(deps.prisma, channel.id, word);
  const texts = detail?.texts ?? [];
  const pg = paginate(texts, page, PAGE_ANSWERS);

  const rows: Btn[][] = pg.slice.map((text, i) => {
    const globalIdx = pg.page * PAGE_ANSWERS + i;
    return [
      {
        label: `${String(globalIdx + 1)}. ${preview(text)}`,
        data: encodeCb("ans", wordIdx, globalIdx),
      },
    ];
  });
  rows.push([{ label: "➕ Добавить ответ", data: encodeCb("adda", wordIdx) }]);
  rows.push([{ label: "🗑 Удалить триггер", data: encodeCb("delw", wordIdx) }]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (p) =>
    encodeCb("tw", wordIdx, p),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow(encodeCb("trg", 0)));

  let header: string;
  if (texts.length === 0) {
    header = `🔑 Триггер «${word}»\n\nОтветов пока нет. Добавь первый — и бот начнёт отвечать на «${word}» в комментах.`;
  } else {
    const now = new Date();
    const health = poolHealth(texts.length, detail?.updatedAt ?? null, now);
    const age = poolAgeDays(detail?.updatedAt ?? null, now);
    const ageLine =
      age === null ? "" : `\nОбновлён ${String(age)} ${pluralDays(age)} назад.`;
    const hint = health.stale
      ? health.reason === "few"
        ? "\n⚠️ Мало ответов — добавь ещё, чтобы не приедались."
        : "\n⚠️ Давно не обновлялся — освежи ответы."
      : "";
    header = `🔑 Триггер «${word}» — ${String(texts.length)} ${pluralAnswers(texts.length)}${ageLine}${hint}\n\nНажми ответ, чтобы изменить или удалить.`;
  }
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран 4 — один ответ: полный текст + изменить/удалить. */
export async function renderAnswer(
  deps: AdminDeps,
  wordIdx: number,
  answerIdx: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const word = channel.triggerWords[wordIdx];
  if (word === undefined) {
    return {
      text: "Триггер не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("trg", 0))]),
    };
  }
  const detail = await getTextPoolDetail(deps.prisma, channel.id, word);
  const texts = detail?.texts ?? [];
  const answer = texts[answerIdx];
  if (answer === undefined) {
    return {
      text: "Ответ не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("tw", wordIdx, 0))]),
    };
  }
  return {
    text: `Ответ #${String(answerIdx + 1)} для «${word}»:\n\n${answer}`,
    keyboard: buildKeyboard([
      [
        { label: "✏️ Изменить", data: encodeCb("edita", wordIdx, answerIdx) },
        { label: "🗑 Удалить", data: encodeCb("dela", wordIdx, answerIdx) },
      ],
      navRow(encodeCb("tw", wordIdx, 0)),
    ]),
  };
}

/** Экран — настройки (тумблеры). */
export async function renderSettings(deps: AdminDeps): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const commentsOn = await getBooleanSetting(
    deps.prisma,
    channel.id,
    COMMENTS_KEY,
    true,
  );
  return {
    text: "⚙️ Настройки",
    keyboard: buildKeyboard([
      [
        {
          label: `💬 Ответы в комментах: ${commentsOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
          data: encodeCb("tgl", "comments"),
        },
      ],
      [{ label: "🤖 AI-ответы: скоро ⏳", data: encodeCb("soon") }],
      [{ label: `⏱ Кулдаун: ${String(COOLDOWN_HOURS)} ч`, data: encodeCb("soon") }],
      navRow(),
    ]),
  };
}

/** Экран — статус канала (сводка). */
export async function renderStatus(deps: AdminDeps): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const [display, summaries, commentsOn] = await Promise.all([
    getChannelDisplay(deps.prisma, channel.id),
    listTriggerSummaries(deps.prisma, channel.id, channel.triggerWords),
    getBooleanSetting(deps.prisma, channel.id, COMMENTS_KEY, true),
  ]);
  const totalAnswers = summaries.reduce((sum, s) => sum + s.count, 0);
  const title = display?.title ?? "—";
  const username = display?.username ? `@${display.username}` : "—";

  const now = new Date();
  const staleWords = summaries
    .filter((s) => poolHealth(s.count, s.updatedAt, now).stale)
    .map((s) => s.word);
  const freshness =
    staleWords.length === 0
      ? "Свежесть пулов: все ок ✅"
      : `⚠️ Освежить пулы: ${staleWords.join(", ")}`;

  const lines = [
    "📊 Статус",
    "",
    `Канал: ${title} (${username})`,
    `Триггеров: ${String(channel.triggerWords.length)}`,
    `Ответов всего: ${String(totalAnswers)}`,
    `Ответы в комментах: ${commentsOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    `Кулдаун: ${String(COOLDOWN_HOURS)} ч`,
    freshness,
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard([navRow()]) };
}

/** Экран-приглашение: жду слово-триггер. */
export function renderAddTriggerPrompt(): Screen {
  return {
    text:
      "➕ Новый триггер\n\nПришли слово одним сообщением (например: звезда).\n" +
      "Бот будет отвечать на него в комментах после добавления ответов.",
    keyboard: buildKeyboard([navRow(encodeCb("trg", 0))]),
  };
}

/** Экран-приглашение: жду текст нового ответа для слова. */
export function renderAddAnswerPrompt(word: string, wordIdx: number): Screen {
  return {
    text:
      `➕ Новый ответ для «${word}»\n\nПришли текст одним сообщением.\n` +
      "Можно использовать {name} — подставится имя пользователя.",
    keyboard: buildKeyboard([navRow(encodeCb("tw", wordIdx, 0))]),
  };
}

/** Экран — автопостинг (Доработка 4.1): статус, канал, неделя/день, список времён. */
export async function renderAutopost(deps: AdminDeps): Promise<Screen> {
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const config = await readAutopostConfig(deps.prisma, channel.id);
  const today = localDateParts(new Date(), channel.timezone);
  const start =
    channel.campaignStart === null
      ? null
      : localDateParts(channel.campaignStart, channel.timezone);
  const { week, day } = resolveCampaignDay(today, start);

  const timesLine =
    config.times.length === 0
      ? "Времена публикации: пока нет — добавь ниже."
      : `Времена публикации (${String(config.times.length)}): ${config.times.join(", ")}`;

  const lines = [
    "📅 Автопостинг",
    "",
    `Статус: ${config.enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    `Канал публикации: ${channel.chatId ?? "не задан ⚠️"}`,
    `Сейчас: неделя ${String(week)}, ${DAY_RU[day] ?? day}`,
    timesLine,
    `Пояс: ${channel.timezone}`,
    "",
    "Бот публикует посты дня по порядку в эти времена.",
  ];

  const rows: Btn[][] = [
    [
      {
        label: config.enabled ? "🔇 Выключить" : "✅ Включить",
        data: encodeCb("atgl"),
      },
    ],
    [{ label: "📡 Указать канал", data: encodeCb("achan") }],
  ];
  // По строке на каждое время — нажатие удаляет его.
  config.times.forEach((t, i) => {
    rows.push([{ label: `🕐 ${t}   ✖ удалить`, data: encodeCb("atdel", i) }]);
  });
  rows.push([{ label: "➕ Добавить время", data: encodeCb("atadd") }]);
  rows.push([{ label: "📤 Опубликовать сейчас (тест)", data: encodeCb("apub") }]);
  rows.push(navRow());

  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран — одобрение постов (Шаг 5): тумблер + сколько ждут + тест-превью. */
export async function renderApproval(deps: AdminDeps): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const [enabled, waiting] = await Promise.all([
    isApprovalEnabled(deps.prisma, channel.id),
    countPending(deps.prisma, channel.id),
  ]);

  const lines = [
    "📋 Одобрение постов",
    "",
    `Статус: ${enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    enabled
      ? "Перед публикацией бот присылает тебе превью с кнопками — пост уходит в канал только после «✅ Опубликовать»."
      : "Посты публикуются автоматически, без предварительного показа.",
    "",
    `Ждут одобрения: ${String(waiting)}`,
  ];

  const rows: Btn[][] = [
    [
      {
        label: enabled ? "🔇 Выключить одобрение" : "✅ Включить одобрение",
        data: encodeCb("aptgl"),
      },
    ],
    [{ label: "👀 Прислать превью (тест)", data: encodeCb("appv") }],
    navRow(),
  ];

  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран-приглашение: жду новое время публикации (ЧЧ:ММ, любое). */
export function renderAddTimePrompt(): Screen {
  return {
    text:
      "➕ Новое время публикации\n\nПришли время в формате ЧЧ:ММ " +
      "(например, 13:47). Можно любое время суток и сколько угодно времён.",
    keyboard: buildKeyboard([navRow(encodeCb("auto"))]),
  };
}

/** Экран-приглашение: жду адрес канала публикации. */
export function renderSetChannelPrompt(): Screen {
  return {
    text:
      "📡 Канал публикации\n\nПришли @username канала (например, @supertestmaster), " +
      "ссылку t.me/… или числовой id канала.\n\n" +
      "⚠️ Бот должен быть админом этого канала с правом публикации.",
    keyboard: buildKeyboard([navRow(encodeCb("auto"))]),
  };
}

/** Экран-приглашение: жду новый текст для редактируемого ответа. */
export function renderEditAnswerPrompt(
  word: string,
  wordIdx: number,
  answerIdx: number,
  current: string,
): Screen {
  return {
    text:
      `✏️ Изменить ответ #${String(answerIdx + 1)} для «${word}»\n\n` +
      `Текущий текст:\n${current}\n\nПришли новый текст одним сообщением.`,
    keyboard: buildKeyboard([navRow(encodeCb("ans", wordIdx, answerIdx))]),
  };
}
