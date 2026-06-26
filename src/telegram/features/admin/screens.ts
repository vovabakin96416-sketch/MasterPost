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
import { shouldWarnContentEnding } from "../../../core/analytics/contentEnding.js";
import { isMtprotoConfigured } from "../../../services/analytics/mtprotoConfig.js";
import {
  getTextPoolDetail,
  listButtonPools,
  listTriggerSummaries,
} from "../../../db/repositories/textPoolRepository.js";
import {
  getButtonPoolMeta,
  getPlanOverview,
  getPostsForWeek,
  getPostDetail,
  type EditablePostField,
} from "../../../db/repositories/postRepository.js";
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

/** Сколько триггеров/ответов/постов показываем на одной странице списка. */
const PAGE_TRIGGERS = 8;
const PAGE_ANSWERS = 6;
const PAGE_POSTS = 8;

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

/** Русское склонение «пост / поста / постов». */
function pluralPosts(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "пост";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "поста";
  }
  return "постов";
}

/** Усечение многострочного текста для показа в экране (новые строки сохраняем). */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
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
  { label: "🗂 Контент-план", data: encodeCb("plan") },
  { label: "🔘 Кнопки под постами", data: encodeCb("bpl") },
  { label: "📊 Аналитика", data: encodeCb("an") },
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

/** Сокращённые дни недели для компактных кнопок списка постов (Шаг 6.5). */
const DAY_SHORT_RU: Record<string, string> = {
  monday: "Пн",
  tuesday: "Вт",
  wednesday: "Ср",
  thursday: "Чт",
  friday: "Пт",
  saturday: "Сб",
  sunday: "Вс",
};

/** Тип интерактива поста по-русски (для экрана поста, Шаг 6.5). */
const INTERACTIVE_RU: Record<string, string> = {
  keyword_trigger: "слово-триггер",
  button_choice: "кнопки-варианты",
  button_prediction: "кнопка с ответом в личку",
  vote_123: "голосование",
};

/** Подписи редактируемых полей поста (Шаг 6.5). Порядок = код в callback (0/1/2). */
const POST_FIELDS: readonly EditablePostField[] = ["title", "text", "cta"];
const POST_FIELD_RU: Record<EditablePostField, string> = {
  title: "Заголовок",
  text: "Текст",
  cta: "Призыв (CTA)",
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
    navRow(),
  ];

  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/**
 * Экран — аналитика (Шаг 7a): текущая неделя контент-плана + статус напоминания о
 * его конце. Отчёт по просмотрам/реакциям (через личный аккаунт) — подшаги 7b/7c.
 */
export async function renderAnalytics(deps: AdminDeps): Promise<Screen> {
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const today = localDateParts(new Date(), channel.timezone);
  const start =
    channel.campaignStart === null
      ? null
      : localDateParts(channel.campaignStart, channel.timezone);
  const { week } = resolveCampaignDay(today, start);

  const mtprotoReady = isMtprotoConfigured(deps.mtproto);
  const lines = [
    "📊 Аналитика",
    "",
    `Контент-план: неделя ${String(week)} из 4`,
    shouldWarnContentEnding(week)
      ? "⚠️ Идёт последняя неделя — пора готовить контент на новый месяц."
      : "Напоминание о конце контента придёт в воскресенье недели 4.",
    "",
    mtprotoReady
      ? "MTProto: настроен ✅ — отчёт по просмотрам приходит в ПН 09:30 МСК."
      : "MTProto: не настроен ⚠️ — отчёт по просмотрам выключен.",
    mtprotoReady
      ? ""
      : "Чтобы включить: задай TELEGRAM_API_ID/HASH и получи сессию командой `npm run gen-session`.",
  ];

  const rows: Btn[][] = [
    [{ label: "📨 Прислать напоминание сейчас (тест)", data: encodeCb("anwarn") }],
  ];
  if (mtprotoReady) {
    rows.push([
      {
        label: "📊 Прислать отчёт по просмотрам (тест)",
        data: encodeCb("anrep"),
      },
    ]);
  }
  rows.push(navRow());

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

/** Поле поста по коду из callback (0/1/2 → title/text/cta) или `undefined`. */
export function postFieldByCode(code: number): EditablePostField | undefined {
  return POST_FIELDS[code];
}

/** Экран — контент-план: список недель с числом постов (Шаг 6.5). */
export async function renderPlan(deps: AdminDeps): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const weeks = await getPlanOverview(deps.prisma, channel.id);
  const rows: Btn[][] = weeks.map((w) => [
    {
      label: `Неделя ${String(w.week)} · ${String(w.count)} ${pluralPosts(w.count)} ›`,
      data: encodeCb("pw", w.week),
    },
  ]);
  rows.push(navRow());

  const header =
    weeks.length === 0
      ? "🗂 Контент-план\n\nПостов пока нет. Залей план: `npm run seed`."
      : `🗂 Контент-план (${String(weeks.length)} нед.)\n\nВыбери неделю — посмотреть и отредактировать посты.`;
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран — посты выбранной недели по порядку день→время (Шаг 6.5). */
export async function renderPlanWeek(
  deps: AdminDeps,
  week: number,
  page: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const posts = await getPostsForWeek(deps.prisma, channel.id, week);
  if (posts.length === 0) {
    return {
      text: `🗂 Неделя ${String(week)}\n\nВ этой неделе нет постов.`,
      keyboard: buildKeyboard([navRow(encodeCb("plan"))]),
    };
  }
  const pg = paginate(posts, page, PAGE_POSTS);

  const rows: Btn[][] = pg.slice.map((p) => [
    {
      label: `${DAY_SHORT_RU[p.day] ?? p.day} ${p.time} · ${preview(p.title, 24)}`,
      data: encodeCb("pp", p.externalId),
    },
  ]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (pp) =>
    encodeCb("pw", week, pp),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow(encodeCb("plan")));

  return {
    text: `🗂 Неделя ${String(week)} — ${String(posts.length)} ${pluralPosts(posts.length)}\n\nНажми пост, чтобы открыть и отредактировать.`,
    keyboard: buildKeyboard(rows),
  };
}

/** Экран — один пост: полный текст полей + кнопки правки/удаления (Шаг 6.5). */
export async function renderPlanPost(
  deps: AdminDeps,
  externalId: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const post = await getPostDetail(deps.prisma, channel.id, externalId);
  if (post === null) {
    return {
      text: "Пост не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("plan"))]),
    };
  }

  const lines = [
    `🗂 Пост #${String(post.externalId)}`,
    `Неделя ${String(post.week)}, ${DAY_RU[post.day] ?? post.day}, ${post.time}`,
    `Тип: ${INTERACTIVE_RU[post.interactiveType] ?? post.interactiveType}`,
    "",
    `📌 Заголовок:\n${post.title}`,
    "",
    `📝 Текст:\n${clip(post.text, 2500)}`,
    "",
    `📣 Призыв:\n${post.cta}`,
  ];
  const rows: Btn[][] = [
    [{ label: "✏️ Заголовок", data: encodeCb("ped", 0, externalId) }],
    [{ label: "✏️ Текст", data: encodeCb("ped", 1, externalId) }],
    [{ label: "✏️ Призыв (CTA)", data: encodeCb("ped", 2, externalId) }],
    [{ label: "👀 Прислать на тест", data: encodeCb("ptest", externalId) }],
    [{ label: "🗑 Удалить пост", data: encodeCb("pdc", externalId) }],
    navRow(encodeCb("pw", post.week)),
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран-приглашение: жду новый текст редактируемого поля поста (Шаг 6.5). */
export function renderEditPostFieldPrompt(
  field: EditablePostField,
  externalId: number,
  current: string,
): Screen {
  return {
    text:
      `✏️ Изменить «${POST_FIELD_RU[field]}» поста #${String(externalId)}\n\n` +
      `Текущее значение:\n${current}\n\nПришли новый текст одним сообщением.`,
    keyboard: buildKeyboard([navRow(encodeCb("pp", externalId))]),
  };
}

/** Экран — подтверждение удаления поста из контент-плана (Шаг 6.5). */
export async function renderDeletePostConfirm(
  deps: AdminDeps,
  externalId: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const post = await getPostDetail(deps.prisma, channel.id, externalId);
  if (post === null) {
    return {
      text: "Пост не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("plan"))]),
    };
  }
  const lines = [
    `🗑 Удалить пост #${String(post.externalId)}?`,
    "",
    `Неделя ${String(post.week)}, ${DAY_RU[post.day] ?? post.day}, ${post.time}`,
    `«${preview(post.title, 60)}»`,
    "",
    "Пост исчезнет из плана. При следующем `npm run seed` он восстановится.",
  ];
  return {
    text: lines.join("\n"),
    keyboard: buildKeyboard([
      [{ label: "🗑 Да, удалить", data: encodeCb("pdel", externalId) }],
      [{ label: "◀ Отмена", data: encodeCb("pp", externalId) }],
    ]),
  };
}

/** Ключ пула кнопок по индексу в актуальном (детерминированном) списке или undefined. */
export async function buttonPoolKeyAt(
  deps: AdminDeps,
  poolIdx: number,
): Promise<string | undefined> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return undefined;
  }
  const pools = await listButtonPools(deps.prisma, channel.id);
  return pools[poolIdx]?.key;
}

/** Экран — список пулов кнопок-предсказаний (доработка 6b). */
export async function renderButtonPools(deps: AdminDeps): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const [pools, meta] = await Promise.all([
    listButtonPools(deps.prisma, channel.id),
    getButtonPoolMeta(deps.prisma, channel.id),
  ]);
  const pg = paginate(pools, 0, PAGE_ANSWERS);
  const now = new Date();

  const rows: Btn[][] = pg.slice.map((pool, i) => {
    const globalIdx = pg.page * PAGE_ANSWERS + i;
    const name = meta.get(pool.key)?.label ?? pool.key;
    const spare = meta.has(pool.key) ? "" : " · про запас";
    const warn = poolHealth(pool.count, pool.updatedAt, now).stale ? " ⚠️" : "";
    return [
      {
        label: `🔘 ${name} · ${String(pool.count)} ${pluralAnswers(pool.count)}${spare}${warn} ›`,
        data: encodeCb("bpo", globalIdx, 0),
      },
    ];
  });
  rows.push(navRow());

  const header =
    pools.length === 0
      ? "🔘 Кнопки под постами\n\nПулов пока нет. Залей контент: `npm run seed`."
      : `🔘 Кнопки под постами (${String(pools.length)})\n\nПулы ответов для кнопок под постами. Нажми кнопку под постом — бот шлёт случайный ответ из пула в личку. «Про запас» = пул пока не привязан ни к одной кнопке.`;
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран — один пул кнопок: его ответы + добавить/изменить/удалить (доработка 6b). */
export async function renderButtonPool(
  deps: AdminDeps,
  poolIdx: number,
  page: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const [pools, meta] = await Promise.all([
    listButtonPools(deps.prisma, channel.id),
    getButtonPoolMeta(deps.prisma, channel.id),
  ]);
  const pool = pools[poolIdx];
  if (pool === undefined) {
    return {
      text: "Пул не найден — возможно, список изменился.",
      keyboard: buildKeyboard([navRow(encodeCb("bpl"))]),
    };
  }
  const name = meta.get(pool.key)?.label ?? pool.key;
  const detail = await getTextPoolDetail(deps.prisma, channel.id, pool.key);
  const texts = detail?.texts ?? [];
  const pg = paginate(texts, page, PAGE_ANSWERS);

  const rows: Btn[][] = pg.slice.map((text, i) => {
    const globalIdx = pg.page * PAGE_ANSWERS + i;
    return [
      {
        label: `${String(globalIdx + 1)}. ${preview(text)}`,
        data: encodeCb("bia", poolIdx, globalIdx),
      },
    ];
  });
  rows.push([{ label: "➕ Добавить ответ", data: encodeCb("baa", poolIdx) }]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (p) =>
    encodeCb("bpo", poolIdx, p),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow(encodeCb("bpl")));

  const spareNote = meta.has(pool.key)
    ? ""
    : "\n💤 Пул пока не подключён к кнопке поста — можно наполнить заранее.";
  let header: string;
  if (texts.length === 0) {
    header = `🔘 «${name}»\n\nОтветов пока нет. Добавь первый — и кнопка начнёт отвечать им в личку.${spareNote}`;
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
    header = `🔘 «${name}» — ${String(texts.length)} ${pluralAnswers(texts.length)}${ageLine}${hint}${spareNote}\n\nНажми ответ, чтобы изменить или удалить.`;
  }
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран — один ответ пула кнопок: полный текст + изменить/удалить (доработка 6b). */
export async function renderButtonAnswer(
  deps: AdminDeps,
  poolIdx: number,
  answerIdx: number,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return noChannelScreen();
  }
  const key = await buttonPoolKeyAt(deps, poolIdx);
  if (key === undefined) {
    return {
      text: "Пул не найден — возможно, список изменился.",
      keyboard: buildKeyboard([navRow(encodeCb("bpl"))]),
    };
  }
  const detail = await getTextPoolDetail(deps.prisma, channel.id, key);
  const texts = detail?.texts ?? [];
  const answer = texts[answerIdx];
  if (answer === undefined) {
    return {
      text: "Ответ не найден — возможно, он был удалён.",
      keyboard: buildKeyboard([navRow(encodeCb("bpo", poolIdx, 0))]),
    };
  }
  return {
    text: `Ответ #${String(answerIdx + 1)}:\n\n${answer}`,
    keyboard: buildKeyboard([
      [
        { label: "✏️ Изменить", data: encodeCb("bea", poolIdx, answerIdx) },
        { label: "🗑 Удалить", data: encodeCb("bda", poolIdx, answerIdx) },
      ],
      navRow(encodeCb("bpo", poolIdx, 0)),
    ]),
  };
}

/** Экран-приглашение: жду новый ответ для пула кнопок (доработка 6b). */
export function renderAddButtonAnswerPrompt(name: string, poolIdx: number): Screen {
  return {
    text:
      `➕ Новый ответ для «${name}»\n\nПришли текст одним сообщением.\n` +
      "Можно использовать {name} — подставится имя пользователя.",
    keyboard: buildKeyboard([navRow(encodeCb("bpo", poolIdx, 0))]),
  };
}

/** Экран-приглашение: жду новый текст редактируемого ответа пула кнопок (доработка 6b). */
export function renderEditButtonAnswerPrompt(
  name: string,
  poolIdx: number,
  answerIdx: number,
  current: string,
): Screen {
  return {
    text:
      `✏️ Изменить ответ #${String(answerIdx + 1)} для «${name}»\n\n` +
      `Текущий текст:\n${current}\n\nПришли новый текст одним сообщением.`,
    keyboard: buildKeyboard([navRow(encodeCb("bia", poolIdx, answerIdx))]),
  };
}

/** Экран пула кнопок, найденного по ключу (индекс резолвим из актуального списка). */
export async function renderButtonPoolByKey(
  deps: AdminDeps,
  key: string,
): Promise<Screen> {
  const channel = await getActiveChannel(deps.prisma);
  if (channel === null) {
    return renderMain();
  }
  const pools = await listButtonPools(deps.prisma, channel.id);
  const idx = pools.findIndex((p) => p.key === key);
  if (idx === -1) {
    return renderButtonPools(deps);
  }
  return renderButtonPool(deps, idx, 0);
}
