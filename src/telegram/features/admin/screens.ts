import { encodeCb } from "../../../core/menu/callbackData.js";
import { paginate } from "../../../core/menu/paginate.js";
import { poolHealth, poolAgeDays } from "../../../core/content/poolHealth.js";
import { getChannelDisplay } from "../../../db/repositories/channelRepository.js";
import {
  resolveChannelMenu,
  resolvePostingChannelSelected,
  resolveSelectedChannel,
} from "./channelContext.js";
import { readAutopostConfig } from "../../../services/autopostSettings.js";
import { readCooldownHours } from "../../../services/cooldownSettings.js";
import { isApprovalEnabled } from "../../../services/approvalService.js";
import { countPending } from "../../../db/repositories/pendingPostRepository.js";
import { localDateParts } from "../../../core/schedule/localDate.js";
import { resolveCampaignDay } from "../../../core/schedule/resolveCampaignDay.js";
import { postStatus } from "../../../core/schedule/postStatus.js";
import { shouldWarnContentEnding } from "../../../core/analytics/contentEnding.js";
import { isMtprotoConfigured } from "../../../services/analytics/mtprotoConfig.js";
import { buildGrowthReport } from "../../../services/analytics/contentIntelligenceService.js";
import { createTelemetrProvider } from "../../../services/market/telemetrProvider.js";
import { buildMarketSectionText } from "../../../services/market/marketStatService.js";
import { narrateGrowthReport } from "../../../services/ai/growthNarrativeService.js";
import { getGrowthNarrativeEnabled } from "../../../services/ai/growthNarrativeSettings.js";
import {
  computeExperimentVerdict,
  formatExperimentProgress,
} from "../../../services/experiments/experimentService.js";
import {
  getLearnedStrategy,
  getStrategyAutoApply,
} from "../../../services/experiments/optimizationService.js";
import { buildStrategySummary } from "../../../core/experiments/learnedStrategy.js";
import { EXPERIMENT_DIMENSIONS } from "../../../core/experiments/experiment.js";
import { adviseNextExperiment } from "../../../services/experiments/experimentAdvisorService.js";
import { getExperimentAdvisorEnabled } from "../../../services/experiments/experimentAdvisorSettings.js";
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
import {
  getAiReplyEnabled,
  getAiTriggerWords,
} from "../../../services/ai/aiReplySettings.js";
import {
  getModerationDelete,
  getModerationEnabled,
  getStopWords,
  getToxicityEnabled,
  getToxicityPolicy,
} from "../../../services/moderation/moderationSettings.js";
import { readDailyCap } from "../../../services/ai/aiBudget.js";
import { buildPostMessage } from "../../../services/postingService.js";
import type { InteractiveType } from "../../../db/repositories/postRepository.js";
import { pluralRu } from "../../../core/text/pluralRu.js";
import { buildKeyboard, navRow, pageRow, preview, type Btn } from "./keyboard.js";
import type { AdminDeps, NewPostDraft, Screen } from "./types.js";

/**
 * Рендереры экранов меню. Каждый возвращает `Screen` (текст + клавиатура).
 * Тематики в коде нет — слова/ответы/настройки берутся из данных канала.
 *
 * Навигация и пагинация — через хелперы `keyboard.ts`; callback-data — через
 * `core/menu/callbackData`. Новый раздел добавляется записью в `MAIN_SECTIONS`
 * плюс своим рендерером и веткой роутера.
 */

/** Подпись кулдауна для меню: «N ч» или «выкл» при 0. */
function cooldownLabel(hours: number): string {
  return hours === 0 ? "выкл" : `${String(hours)} ч`;
}

/** Сколько триггеров/ответов/постов показываем на одной странице списка. */
const PAGE_TRIGGERS = 8;
const PAGE_ANSWERS = 6;
const PAGE_POSTS = 8;
/** Сколько AI-триггеров показываем на одной странице (Шаг 11c). */
const PAGE_AI_TRIGGERS = 8;
/** Сколько стоп-слов модерации показываем на одной странице (Шаг 11d). */
const PAGE_STOP_WORDS = 8;

/** Ключ настройки «отвечать в комментах» (как в Шаге 2). */
const COMMENTS_KEY = "comments_enabled";

/** Склонения слов меню — формы к общему правилу `pluralRu`. */
const pluralAnswers = (n: number): string => pluralRu(n, ["ответ", "ответа", "ответов"]);
const pluralPosts = (n: number): string => pluralRu(n, ["пост", "поста", "постов"]);
const pluralDays = (n: number): string => pluralRu(n, ["день", "дня", "дней"]);

/** Усечение многострочного текста для показа в экране (новые строки сохраняем). */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Раздел главного меню (кнопка + callback). Новый раздел = одна запись здесь. */
interface Section {
  readonly label: string;
  readonly data: string;
}

/**
 * Главное меню — РЯДЫ по 2 кнопки, сгруппированные по смыслу (частое — сверху):
 * контент → публикация → комменты → канал → сводки. Кнопки-заглушки «скоро»
 * на главную не выносим (строка про AI-ответы живёт в «💬 Комментарии»).
 */
export const MAIN_SECTIONS: readonly (readonly Section[])[] = [
  // Редизайн (вар. B): «📅 План» = слитые «Календарь»+«Контент-план» (подшаг 1);
  // «💬 Комментарии» (`set`) = бывш. «Настройки» + «Триггеры» + «Статус→Сводка»
  // (подшаг 2). Финальная раскладка (быстрые действия + бейдж) — подшаг 3.
  [
    { label: "📅 План", data: encodeCb("cal") },
    { label: "➕ Новый пост", data: encodeCb("np") },
  ],
  [
    { label: "🤖 AI-пост", data: encodeCb("aigen") },
    { label: "📈 Рост", data: encodeCb("grow") },
  ],
  [
    { label: "📅 Автопостинг", data: encodeCb("auto") },
    { label: "📋 Одобрение", data: encodeCb("appr") },
  ],
  [
    { label: "🔘 Кнопки постов", data: encodeCb("bpl") },
    { label: "📈 Аналитика", data: encodeCb("an") },
  ],
  [
    { label: "📡 Каналы", data: encodeCb("ch") },
    { label: "💬 Комментарии", data: encodeCb("set") },
  ],
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

/** Экран-заглушка, когда канала нет: ведём владельца добавить канал, не в консоль. */
function noChannelScreen(): Screen {
  return {
    text:
      "Канал пока не подключён.\n\n" +
      "Сначала добавь канал: «📡 Каналы → ➕ Добавить канал» — или просто добавь бота " +
      "админом в свой канал, он подключится сам.\n" +
      "(Для разработчика: тестовые данные заливает `npm run seed`.)",
    keyboard: buildKeyboard([
      [{ label: "📡 Каналы", data: encodeCb("ch") }],
      navRow(),
    ]),
  };
}

/** Подпись канала для шапки/списка: «Название (@username)» или «Название». */
function channelLabel(item: { title: string; username: string | null }): string {
  return item.username ? `${item.title} (@${item.username})` : item.title;
}

/**
 * Экран 1 — главное меню. Шапка показывает текущий канал (Шаг 8a): владелец видит,
 * каким каналом управляет, и переключает его в разделе «📡 Каналы».
 */
export async function renderMain(deps: AdminDeps): Promise<Screen> {
  const { channels, currentId } = await resolveChannelMenu(deps);
  const current = channels.find((c) => c.id === currentId);
  const header = current
    ? `📡 Канал: ${channelLabel(current)}`
    : "📡 Канал не выбран — добавь в разделе «Каналы».";
  const rows = MAIN_SECTIONS.map((row): Btn[] =>
    row.map((s) => ({ label: s.label, data: s.data })),
  );
  return {
    text:
      `🤖 Меню управления\n\n${header}\n\n` +
      "Сверху — контент и публикация, ниже — ответы в комментах, каналы и сводки:",
    keyboard: buildKeyboard(rows),
  };
}

/**
 * Экран «📡 Каналы» (Шаг 8a) — реестр каналов владельца + переключатель текущего.
 * Маркер ● у текущего; «○» у активного, «🔇» у выключенного. Кнопка слова канала
 * делает его текущим; «⚙️» открывает карточку; «➕» добавляет новый.
 */
export async function renderChannels(deps: AdminDeps): Promise<Screen> {
  const { channels, currentId } = await resolveChannelMenu(deps);

  const rows: Btn[][] = channels.map((c, i): Btn[] => {
    const mark = c.id === currentId ? "● " : c.isActive ? "○ " : "🔇 ";
    return [
      { label: `${mark}${channelLabel(c)}`, data: encodeCb("chsel", i) },
      { label: "⚙️", data: encodeCb("chd", i) },
    ];
  });
  rows.push([{ label: "➕ Добавить канал", data: encodeCb("chadd") }]);
  rows.push(navRow());

  const header =
    channels.length === 0
      ? "📡 Каналы\n\nПока нет ни одного канала. Добавь первый — или запусти сид."
      : `📡 Каналы (${String(channels.length)})\n\nНажми канал, чтобы сделать его текущим (с ним работают все разделы меню). ⚙️ — карточка канала.\n\n● текущий · ○ активный · 🔇 выключен`;
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран — карточка одного канала (Шаг 8a): сводка + сделать текущим / цель / активность. */
export async function renderChannelDetail(
  deps: AdminDeps,
  idx: number,
): Promise<Screen> {
  const { channels, currentId } = await resolveChannelMenu(deps);
  const channel = channels[idx];
  if (channel === undefined) {
    return renderChannels(deps);
  }

  const isCurrent = channel.id === currentId;
  const lines = [
    `📡 ${channelLabel(channel)}`,
    "",
    `Ниша: ${channel.niche}`,
    `Канал публикации: ${channel.chatId ?? "не задан ⚠️"}`,
    `Активность: ${channel.isActive ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    isCurrent ? "\nЭто текущий канал — им управляют все разделы меню." : "",
    "\nℹ️ Каждый активный канал бот ведёт сам: автопостинг и ответы в комментах работают по его настройкам и цели публикации.",
  ];

  const rows: Btn[][] = [];
  if (!isCurrent) {
    rows.push([{ label: "✅ Сделать текущим", data: encodeCb("chsel", idx) }]);
  }
  rows.push([{ label: "🎯 Канал публикации", data: encodeCb("chtgt", idx) }]);
  rows.push([{ label: "🛡 Проверить права", data: encodeCb("chk", idx) }]);
  rows.push([
    {
      label: channel.isActive ? "🔇 Выключить канал" : "✅ Включить канал",
      data: encodeCb("chact", idx),
    },
  ]);
  rows.push(navRow(encodeCb("ch")));

  return { text: lines.filter((l) => l !== "").join("\n"), keyboard: buildKeyboard(rows) };
}

/**
 * Экран результата «🛡 Проверить права» (Шаг 9a): сводка прав бота в канале + назад в карточку.
 * Чистое форматирование — вызов Telegram API (`getChatMember`) делает роутер, сюда передаёт
 * уже готовый отчёт (`summary` + список недостающих прав).
 */
export function renderRightsCheck(
  report: { summary: string; missing: string[] },
  channelTitle: string,
  idx: number,
): Screen {
  const lines = [`🛡 Права бота в канале «${channelTitle}»`, "", report.summary];
  if (report.missing.length > 0) {
    lines.push(
      "",
      "Открой настройки канала → Администраторы → бот и выдай недостающие права.",
    );
  }
  return {
    text: lines.join("\n"),
    keyboard: buildKeyboard([navRow(encodeCb("chd", idx))]),
  };
}

/** Экран-приглашение: жду название нового канала (Шаг 8a). */
export function renderAddChannelPrompt(): Screen {
  return {
    text:
      "➕ Новый канал\n\nПришли название канала одним сообщением (например: Бизнес-советы).\n" +
      "Канал создастся пустым и станет текущим — контент, триггеры и цель публикации зададим в разделах меню.",
    keyboard: buildKeyboard([navRow(encodeCb("ch"))]),
  };
}

/** Экран 2 — список слов-триггеров со счётчиком ответов. */
export async function renderTriggers(
  deps: AdminDeps,
  page: number,
): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
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
  rows.push(navRow(encodeCb("set")));

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
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
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

/**
 * Экран «💬 Комментарии» (редизайн вар. B, подшаг 2; бывш. «⚙️ Настройки») —
 * всё поведение бота под постами в одном месте: мастер-тумблер ответов, готовые
 * «💬 Триггеры», «🤖 AI-ответы», «🛡 Модерация», «⏱ Кулдаун» и «📋 Сводка» (бывш. «Статус»).
 * Отвечает на «почему в настройках комментарии» — теперь раздел назван по сути.
 */
export async function renderSettings(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const [commentsOn, cooldownHours, aiReplyOn, moderationOn] = await Promise.all([
    getBooleanSetting(deps.prisma, channel.id, COMMENTS_KEY, true),
    readCooldownHours(deps.prisma, channel.id),
    getAiReplyEnabled(deps.prisma, channel.id),
    getModerationEnabled(deps.prisma, channel.id),
  ]);
  return {
    text:
      "💬 Комментарии\n\n" +
      "Как бот ведёт себя под постами: отвечает, чистит спам, держит паузы.",
    keyboard: buildKeyboard([
      [
        {
          label: `💬 Ответы в комментах: ${commentsOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
          data: encodeCb("tgl", "comments"),
        },
      ],
      [{ label: "💬 Триггеры (готовые ответы)", data: encodeCb("trg", 0) }],
      [
        {
          label: `🤖 AI-ответы: ${aiReplyOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"} ›`,
          data: encodeCb("eng"),
        },
      ],
      [
        {
          label: `🛡 Модерация: ${moderationOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"} ›`,
          data: encodeCb("mod"),
        },
      ],
      [{ label: `⏱ Кулдаун: ${cooldownLabel(cooldownHours)}`, data: encodeCb("cd") }],
      [{ label: "📋 Сводка", data: encodeCb("stat") }],
      navRow(),
    ]),
  };
}

/**
 * Экран «Engagement» (Шаг 11c) — AI-ответ в комментах голосом канала: тумблер фичи,
 * дневной лимит AI-вызовов (пер-канальный, SaaS) и отдельный набор AI-триггеров.
 * Пул готовых текстов (раздел «💬 Триггеры») не трогаем — это самостоятельный набор.
 */
export async function renderEngagement(
  deps: AdminDeps,
  page: number,
): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const [enabled, words, cap] = await Promise.all([
    getAiReplyEnabled(deps.prisma, channel.id),
    getAiTriggerWords(deps.prisma, channel.id),
    readDailyCap(deps.prisma, channel.id),
  ]);
  const pg = paginate(words, page, PAGE_AI_TRIGGERS);

  const rows: Btn[][] = [
    [
      {
        label: `🤖 AI-ответы: ${enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
        data: encodeCb("engtgl"),
      },
    ],
    [
      {
        label: `📊 Дневной лимит: ${cap === 0 ? "выкл" : String(cap)}`,
        data: encodeCb("aicap"),
      },
    ],
  ];
  // Каждый AI-триггер — кнопка удаления (слов немного, отдельного экрана не нужно).
  pg.slice.forEach((word, i) => {
    const globalIdx = pg.page * PAGE_AI_TRIGGERS + i;
    rows.push([{ label: `❌ ${word}`, data: encodeCb("aidelw", globalIdx, pg.page) }]);
  });
  rows.push([{ label: "➕ Добавить AI-триггер", data: encodeCb("aiaddw") }]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (p) =>
    encodeCb("eng", p),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow(encodeCb("set")));

  const lines = [
    "🤖 AI-ответы в комментах",
    "",
    `Статус: ${enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    `Дневной лимит вызовов: ${cap === 0 ? "0 (отключено)" : String(cap)}`,
    "",
    words.length === 0
      ? "AI-триггеров пока нет. Добавь слова, на которые бот ответит голосом канала."
      : `AI-триггеров: ${String(words.length)}. Бот отвечает, когда коммент содержит одно из этих слов.`,
    "",
    "⚠️ Ответы генерирует Claude — тратят токены. Защита: этот лимит, кулдаун и тумблер.",
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран-приглашение: жду слово для набора AI-триггеров (Шаг 11c). */
export function renderAddAiTriggerPrompt(): Screen {
  return {
    text:
      "➕ Новый AI-триггер\n\nПришли слово или короткую фразу одним сообщением " +
      "(например: совет).\nКогда коммент содержит это слово, бот ответит голосом канала.",
    keyboard: buildKeyboard([navRow(encodeCb("eng", 0))]),
  };
}

/** Экран-приглашение: жду число — дневной лимит AI-вызовов (0 — отключить). */
export function renderSetAiCapPrompt(): Screen {
  return {
    text:
      "📊 Дневной лимит AI-вызовов\n\nПришли число одним сообщением (например, 50).\n" +
      "Столько AI-ответов канал сделает за сутки — защита от расхода токенов.\n" +
      "Пришли 0, чтобы полностью отключить платные AI-вызовы.",
    keyboard: buildKeyboard([navRow(encodeCb("eng", 0))]),
  };
}

/**
 * Экран «🛡 Модерация» — антиспам без AI (Шаг 11d: тумблер + авто-удаление + стоп-слова,
 * 0 токенов) плюс семантическая токсичность через Haiku (Шаг 11e: тумблер + своя политика,
 * платно, лимит общий с AI-ответами). Действие у обоих слоёв общее: сигнал админу или
 * авто-удаление (`moddel`, нужны права бота).
 */
export async function renderModeration(
  deps: AdminDeps,
  page: number,
): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const [enabled, autoDelete, words, toxicityOn, policy] = await Promise.all([
    getModerationEnabled(deps.prisma, channel.id),
    getModerationDelete(deps.prisma, channel.id),
    getStopWords(deps.prisma, channel.id),
    getToxicityEnabled(deps.prisma, channel.id),
    getToxicityPolicy(deps.prisma, channel.id),
  ]);
  const pg = paginate(words, page, PAGE_STOP_WORDS);

  const rows: Btn[][] = [
    [
      {
        label: `🛡 Модерация: ${enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
        data: encodeCb("modtgl"),
      },
    ],
    [
      {
        label: `🗑 Удалять спам: ${autoDelete ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
        data: encodeCb("moddel"),
      },
    ],
    [
      {
        label: `🧠 Токсичность (AI): ${toxicityOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
        data: encodeCb("toxtgl"),
      },
    ],
    [
      {
        label: `📝 Политика: ${policy === "" ? "авто по нише" : "своя"}`,
        data: encodeCb("toxpol"),
      },
    ],
  ];
  // Каждое стоп-слово — кнопка удаления (список короткий, отдельного экрана не нужно).
  pg.slice.forEach((word, i) => {
    const globalIdx = pg.page * PAGE_STOP_WORDS + i;
    rows.push([
      { label: `❌ ${word}`, data: encodeCb("moddelw", globalIdx, pg.page) },
    ]);
  });
  rows.push([{ label: "➕ Добавить стоп-слово", data: encodeCb("modaddw") }]);
  const pager = pageRow(pg.page, pg.hasPrev, pg.hasNext, (p) =>
    encodeCb("mod", p),
  );
  if (pager.length > 0) {
    rows.push(pager);
  }
  rows.push(navRow(encodeCb("set")));

  const lines = [
    "🛡 Модерация комментов",
    "",
    `Статус: ${enabled ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    `Авто-удаление: ${autoDelete ? "ВКЛ ✅ (нужны права бота)" : "ВЫКЛ 🔇 — только сигнал"}`,
    "",
    "Эвристики (без AI, без токенов): ссылки, флуд @-упоминаний, растянутый текст.",
    words.length === 0
      ? "Стоп-слов пока нет. Добавь слова, за которые коммент считать спамом."
      : `Стоп-слов: ${String(words.length)}.`,
    "",
    `🧠 Токсичность (AI): ${toxicityOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"} — ловит враждебность по смыслу`,
    "(нападки, оскорбления) в контексте ниши канала.",
    "⚠️ Тратит токены (Haiku), лимит ОБЩИЙ с AI-ответами.",
    policy === "" ? "Политика: авто по нише." : `Политика: ${policy}`,
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран-приглашение: жду правило политики токсичности либо «-» для сброса (Шаг 11e). */
export function renderSetToxicityPolicyPrompt(): Screen {
  return {
    text:
      "📝 Политика токсичности\n\nПришли одним сообщением своё правило — что для этого " +
      "канала считать токсичным (например: насмешки над картами таро и верящими людьми).\n" +
      "Пришли «-», чтобы сбросить на авто-оценку по нише канала.",
    keyboard: buildKeyboard([navRow(encodeCb("mod", 0))]),
  };
}

/** Экран-приглашение: жду стоп-слово для модерации (Шаг 11d). */
export function renderAddStopWordPrompt(): Screen {
  return {
    text:
      "➕ Новое стоп-слово\n\nПришли слово или короткую фразу одним сообщением " +
      "(например: казино).\nКоммент, содержащий это слово, будет считаться спамом.",
    keyboard: buildKeyboard([navRow(encodeCb("mod", 0))]),
  };
}

/**
 * Экран «📋 Сводка» (бывш. «📊 Статус»; редизайн вар. B, подшаг 2) — быстрая сводка
 * по общению: триггеры, ответы, вкл/выкл комментов, кулдаун, свежесть пулов.
 * Живёт внутри раздела «💬 Комментарии» (это про общение, не про просмотры).
 */
export async function renderStatus(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const [display, summaries, commentsOn, cooldownHours] = await Promise.all([
    getChannelDisplay(deps.prisma, channel.id),
    listTriggerSummaries(deps.prisma, channel.id, channel.triggerWords),
    getBooleanSetting(deps.prisma, channel.id, COMMENTS_KEY, true),
    readCooldownHours(deps.prisma, channel.id),
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
    "📋 Сводка",
    "",
    `Канал: ${title} (${username})`,
    `Триггеров: ${String(channel.triggerWords.length)}`,
    `Ответов всего: ${String(totalAnswers)}`,
    `Ответы в комментах: ${commentsOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
    `Кулдаун: ${cooldownLabel(cooldownHours)}`,
    freshness,
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard([navRow(encodeCb("set"))]) };
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
  const channel = await resolvePostingChannelSelected(deps);
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
    `AI когда план пуст: ${config.aiEnabled ? "ВКЛ 🤖" : "ВЫКЛ 🔇"}`,
    `Канал публикации: ${channel.chatId ?? "не задан ⚠️"}`,
    `Сейчас: неделя ${String(week)}, ${DAY_RU[day] ?? day}`,
    timesLine,
    `Пояс: ${channel.timezone}`,
    "",
    "Бот публикует посты дня по порядку в эти времена.",
    config.aiEnabled
      ? "🤖 Если на слот нет готового поста — бот сам напишет пост голосом канала. Показ/публикация подчиняются тумблеру «📋 Одобрение»."
      : "🤖 Можно включить AI-подхват: если на слот нет готового поста, бот напишет его сам.",
  ];

  const rows: Btn[][] = [
    [
      {
        label: config.enabled ? "🔇 Выключить" : "✅ Включить",
        data: encodeCb("atgl"),
      },
    ],
    [
      {
        label: config.aiEnabled ? "🔇 Выключить AI-подхват" : "🤖 Включить AI-подхват",
        data: encodeCb("aitgl"),
      },
    ],
    [{ label: "🎯 Канал публикации", data: encodeCb("achan") }],
  ];
  // По строке на каждое время — нажатие удаляет его.
  config.times.forEach((t, i) => {
    rows.push([{ label: `🕐 ${t}   ✖ удалить`, data: encodeCb("atdel", i) }]);
  });
  rows.push([{ label: "➕ Добавить время", data: encodeCb("atadd") }]);
  rows.push(navRow());

  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/** Экран — одобрение постов (Шаг 5): тумблер + сколько ждут + тест-превью. */
export async function renderApproval(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolvePostingChannelSelected(deps);
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

/** Экран-приглашение: жду число часов кулдауна (0 — отключить). */
export function renderSetCooldownPrompt(): Screen {
  return {
    text:
      "⏱ Кулдаун триггеров\n\nПришли число часов одним сообщением (например, 24).\n" +
      "Пользователь не сможет повторно дёргать триггер чаще, чем раз в это время.\n" +
      "Пришли 0, чтобы отключить кулдаун.",
    keyboard: buildKeyboard([navRow(encodeCb("set"))]),
  };
}

/** Экран-приглашение: жду адрес канала публикации. */
export function renderSetChannelPrompt(): Screen {
  return {
    text:
      "🎯 Канал публикации\n\nПришли @username канала (например, @supertestmaster), " +
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

/**
 * Экран «📅 План» (Шаг 11a; редизайн вар. B): точка входа раздела плана — текущая
 * неделя по дням с маркерами ✅ прошёл / ▶️ сегодня / 🔜 впереди. Отвечает на
 * «не вижу, где мы в плане». Строки-посты кликабельны в редактор поста (`pp`);
 * «🗂 Весь план» ведёт к списку недель (`renderPlan`) для правки.
 */
export async function renderCalendar(deps: AdminDeps): Promise<Screen> {
  const channel = await resolvePostingChannelSelected(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const today = localDateParts(new Date(), channel.timezone);
  const start =
    channel.campaignStart === null
      ? null
      : localDateParts(channel.campaignStart, channel.timezone);
  const { week } = resolveCampaignDay(today, start);
  const posts = await getPostsForWeek(deps.prisma, channel.id, week);

  const lines = [
    "📅 План",
    "",
    `Неделя ${String(week)} из 4 · сегодня ${DAY_RU[today.weekday] ?? today.weekday}`,
    "Легенда: ✅ прошёл · ▶️ сегодня · 🔜 впереди",
  ];
  if (channel.campaignStart === null) {
    lines.push(
      "",
      "⚠️ Старт плана ещё не зафиксирован — включи «📅 Автопостинг», и недели пойдут по порядку.",
    );
  }
  if (posts.length === 0) {
    lines.push("", "В этой неделе постов нет.");
    return {
      text: lines.join("\n"),
      keyboard: buildKeyboard([
        [{ label: "🗂 Весь план (4 нед.)", data: encodeCb("plan") }],
        navRow(),
      ]),
    };
  }

  const rows: Btn[][] = posts.map((p) => {
    const st = postStatus(today, p.day, p.time);
    const mark = st === "passed" ? "✅" : st === "today" ? "▶️" : "🔜";
    return [
      {
        label: `${mark} ${DAY_SHORT_RU[p.day] ?? p.day} ${p.time} · ${preview(p.title, 20)}`,
        data: encodeCb("pp", p.externalId),
      },
    ];
  });
  rows.push([{ label: "🗂 Весь план (4 нед.)", data: encodeCb("plan") }]);
  rows.push(navRow());

  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/**
 * Экран «📈 Рост» (Шаг 12c) — Content Intelligence: выводы «что зашло / когда лучше
 * публиковать / тренд охвата» + рекомендации советника. Читает из БД (метрики 7c/12b +
 * снимки охвата), 0 токенов; при ВКЛ тумблере «🧠 AI-пересказ» (12d) те же факты
 * пересказывает Haiku голосом канала (фолбэк — сухой текст, бюджет общий).
 * Текст собирает `buildGrowthReport` (плейн, без Markdown —
 * `editMessageText` идёт без parse_mode). Данные наполняет джоб снимка (22:00 МСК) и
 * еженедельный отчёт; без MTProto таблицы пустеют → отчёт покажет понятную заглушку.
 */
export async function renderGrowth(deps: AdminDeps): Promise<Screen> {
  const channel = await resolvePostingChannelSelected(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const facts = await buildGrowthReport(deps.prisma, channel.id, channel.timezone);
  // Шаг 12d: опциональный AI-пересказ тех же фактов голосом канала (тумблер, дефолт
  // ВЫКЛ). Любой отказ внутри (ключ/бюджет/ошибка) → сухой текст 12c без изменений.
  const narrativeOn = await getGrowthNarrativeEnabled(deps.prisma, channel.id);
  const report = narrativeOn
    ? await narrateGrowthReport(
        {
          prisma: deps.prisma,
          logger: deps.logger,
          apiKey: deps.anthropicApiKey,
          timeoutMs: deps.timeoutMs,
        },
        channel.id,
        facts,
      )
    : facts;
  // Шаг 12e: секция «🌍 Рынок» — внешний взгляд Telemetr на канал. Добавляется
  // ПОСЛЕ пересказа (в AI рыночные данные не скармливаем — 0 новых токенов).
  // Без ключа/данных секции нет; лимит API бережёт кэш в Setting (TTL 12ч).
  const marketProvider = createTelemetrProvider({
    apiKey: deps.telemetrApiKey,
    logger: deps.logger,
  });
  const marketSection = await buildMarketSectionText(
    deps.prisma,
    deps.logger,
    channel,
    marketProvider,
  );
  const market = marketSection === null ? "" : `\n\n${marketSection}`;
  const hint = isMtprotoConfigured(deps.mtproto)
    ? "\n\nОбновляется автоматически: снимок охвата — ежедневно, полный отчёт — в ПН 09:30 МСК."
    : "\n\n⚠️ MTProto не настроен — метрики не собираются, выводы будут скудными. Включи его в «📊 Аналитика».";
  const narrativeHint = narrativeOn
    ? "\n🧠 AI-пересказ включён — тратит токены (лимит общий с AI-ответами)."
    : "";
  return {
    text: `${report}${market}${hint}${narrativeHint}`,
    keyboard: buildKeyboard([
      [
        {
          label: `🧠 AI-пересказ: ${narrativeOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
          data: encodeCb("gntgl"),
        },
      ],
      [{ label: "🧪 Эксперименты", data: encodeCb("exp") }],
      [{ label: "📊 Аналитика", data: encodeCb("an") }],
      navRow(),
    ]),
  };
}

/**
 * Экран «🧪 Эксперименты» (Шаг 13d) — последовательный A/B над AI-постами. Идёт
 * эксперимент → прогресс вариантов (число постов + ERR) + вердикт 13a и кнопка
 * «остановить». Не идёт → предложение запустить одно измерение из каталога 13a.
 * Плейн-текст без Markdown-эмфазы (правило 12c) — тот же текст уходит и в отчёт.
 */
export async function renderExperiments(deps: AdminDeps): Promise<Screen> {
  const channel = await resolvePostingChannelSelected(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  // Шаг 13e: выученная стратегия канала + тумблер авто-применения победителя.
  const autoApply = await getStrategyAutoApply(deps.prisma, channel.id);
  const strategy = await getLearnedStrategy(deps.prisma, channel.id);
  const summary = buildStrategySummary(strategy, new Date());
  const autoRow: Btn[] = [
    {
      label: `🔁 Авто-применение: ${autoApply ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
      data: encodeCb("xauto"),
    },
  ];

  const cv = await computeExperimentVerdict(deps.prisma, channel.id);
  if (cv !== null) {
    const progress = formatExperimentProgress(cv, channel.timezone);
    const text =
      `${progress}\n\n📚 Выученная стратегия:\n${summary}\n\n` +
      "Бот чередует 2 варианта между AI-постами и сравнивает вовлечённость (ERR).";
    const rows: Btn[][] = [];
    // Победитель готов → кнопка применения (в стратегию, эксперимент завершится).
    if (cv.verdict.status === "winner") {
      rows.push([{ label: "✅ Применить победителя", data: encodeCb("xapply") }]);
    }
    rows.push([{ label: "⏹ Остановить эксперимент", data: encodeCb("xstop") }]);
    rows.push(autoRow);
    rows.push(navRow(encodeCb("grow")));
    return { text, keyboard: buildKeyboard(rows) };
  }
  // Активного эксперимента нет — предлагаем запустить одно из измерений каталога.
  const rows: Btn[][] = EXPERIMENT_DIMENSIONS.map((d, i) => [
    { label: `▶️ ${d.label}`, data: encodeCb("xstart", i) },
  ]);
  // Шаг 13f: AI-советник «что тестировать?» — кнопка совета при ВКЛ тумблере (тратит
  // токен по требованию), сам тумблер (дефолт ВЫКЛ) виден всегда.
  const advisorOn = await getExperimentAdvisorEnabled(deps.prisma, channel.id);
  if (advisorOn) {
    rows.push([{ label: "🔮 Совет: что тестировать?", data: encodeCb("xadvise") }]);
  }
  rows.push([
    {
      label: `🔮 AI-советник: ${advisorOn ? "ВКЛ ✅" : "ВЫКЛ 🔇"}`,
      data: encodeCb("xadvtgl"),
    },
  ]);
  rows.push(autoRow);
  rows.push(navRow(encodeCb("grow")));
  const lines = [
    "🧪 Эксперименты",
    "",
    "Сейчас эксперимент не идёт.",
    "",
    "Запусти проверку одного измерения — бот будет чередовать 2 варианта между " +
      "AI-постами и сравнит вовлечённость (ERR). Нужно ~5 постов на вариант (2–4 недели).",
    "",
    "📚 Выученная стратегия:",
    summary,
    "",
    "Что проверяем:",
  ];
  return { text: lines.join("\n"), keyboard: buildKeyboard(rows) };
}

/**
 * Экран «🔮 Совет: что тестировать?» (Шаг 13f) — по нажатию Haiku смотрит на инсайты
 * 12c и предлагает ОДНО измерение каталога 13a с обоснованием. Кнопка «✅ Запустить»
 * переиспользует путь запуска `xstart` (по индексу измерения). Любой отказ внутри
 * (тумблер/ключ/бюджет/ошибка) → понятная заглушка, без падения. Плейн-текст (12c).
 */
export async function renderExperimentAdvice(deps: AdminDeps): Promise<Screen> {
  const channel = await resolvePostingChannelSelected(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  // Идёт эксперимент — совет неуместен (одно измерение за раз): назад к экрану.
  const active = await computeExperimentVerdict(deps.prisma, channel.id);
  if (active !== null) {
    return renderExperiments(deps);
  }
  const facts = await buildGrowthReport(deps.prisma, channel.id, channel.timezone);
  const advice = await adviseNextExperiment(
    {
      prisma: deps.prisma,
      logger: deps.logger,
      apiKey: deps.anthropicApiKey,
      timeoutMs: deps.timeoutMs,
    },
    channel.id,
    facts,
  );
  if (advice === null) {
    return {
      text:
        "🔮 Совет: что тестировать?\n\n" +
        "Не удалось получить совет: возможно, выключен AI-советник, нет ключа, исчерпан " +
        "дневной лимит или пока мало данных. Можно запустить измерение вручную.",
      keyboard: buildKeyboard([navRow(encodeCb("exp"))]),
    };
  }
  const idx = EXPERIMENT_DIMENSIONS.findIndex((d) => d.dimension === advice.dimension);
  const rows: Btn[][] = [];
  if (idx >= 0) {
    rows.push([
      { label: `✅ Запустить «${advice.label}»`, data: encodeCb("xstart", idx) },
    ]);
  }
  rows.push(navRow(encodeCb("exp")));
  const text = [
    "🔮 Совет: что тестировать следующим",
    "",
    `Измерение: ${advice.label}`,
    "",
    advice.rationale,
    "",
    "Запусти его кнопкой ниже — бот начнёт чередовать варианты между AI-постами.",
  ].join("\n");
  return { text, keyboard: buildKeyboard(rows) };
}

/**
 * Экран «🗂 Весь план» — список недель с числом постов (Шаг 6.5; редизайн вар. B).
 * Под-экран раздела «📅 План»: «◀ Назад» ведёт к текущей неделе (`cal`).
 */
export async function renderPlan(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
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
  rows.push([{ label: "➕ Новый пост (разовый)", data: encodeCb("np") }]);
  rows.push(navRow(encodeCb("cal")));

  const header =
    weeks.length === 0
      ? "🗂 Весь план\n\nПостов недельного плана пока нет (залей: `npm run seed`).\nМожно добавить разовый пост ниже."
      : `🗂 Весь план (${String(weeks.length)} нед.)\n\nВыбери неделю — посмотреть и отредактировать посты, либо добавь разовый пост.`;
  return { text: header, keyboard: buildKeyboard(rows) };
}

/** Экран — посты выбранной недели по порядку день→время (Шаг 6.5). */
export async function renderPlanWeek(
  deps: AdminDeps,
  week: number,
  page: number,
): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return undefined;
  }
  const pools = await listButtonPools(deps.prisma, channel.id);
  return pools[poolIdx]?.key;
}

/** Экран — список пулов кнопок-предсказаний (доработка 6b). */
export async function renderButtonPools(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
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
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return renderMain(deps);
  }
  const pools = await listButtonPools(deps.prisma, channel.id);
  const idx = pools.findIndex((p) => p.key === key);
  if (idx === -1) {
    return renderButtonPools(deps);
  }
  return renderButtonPool(deps, idx, 0);
}

// ─── Мастер «Новый пост» (разовая публикация, Шаг 6c) ─────────────────────────

/** Типы интерактива в порядке кнопок мастера (код = индекс). */
const NEW_POST_INTERACTIVE: readonly { type: InteractiveType; label: string }[] = [
  { type: "keyword_trigger", label: "Без кнопок" },
  { type: "button_choice", label: "Кнопки-варианты" },
  { type: "button_prediction", label: "Кнопка → ответ в личку" },
  { type: "vote_123", label: "Голосование (реакции)" },
];

/** Тип интерактива по коду кнопки мастера (или undefined). */
export function newPostInteractiveByCode(code: number): InteractiveType | undefined {
  return NEW_POST_INTERACTIVE[code]?.type;
}

/** Ряд «✖ Отмена» — выйти из мастера, сбросив черновик. */
function cancelRow(): Btn[] {
  return [{ label: "✖ Отмена", data: encodeCb("npx") }];
}

/** Дата-время в поясе канала: «ДД.ММ.ГГГГ ЧЧ:ММ». */
function fmtLocalDateTime(date: Date, timeZone: string): string {
  const p = localDateParts(date, timeZone);
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return `${pad(p.day)}.${pad(p.month)}.${String(p.year)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Универсальный экран-приглашение шага мастера (текст + «Отмена»). */
export function renderNewPostPrompt(text: string): Screen {
  return { text, keyboard: buildKeyboard([cancelRow()]) };
}

/** Экран выбора типа интерактива. */
export function renderNewPostInteractive(): Screen {
  const rows: Btn[][] = NEW_POST_INTERACTIVE.map((it, i) => [
    { label: it.label, data: encodeCb("npit", i) },
  ]);
  rows.push(cancelRow());
  return {
    text: "🧩 Интерактив поста\n\nВыбери, что добавить к посту.",
    keyboard: buildKeyboard(rows),
  };
}

/** Экран цикла ввода вариантов button_choice (накопленные + «Готово»). */
export function renderNewPostChoices(draft: NewPostDraft): Screen {
  const list =
    draft.choices.length === 0
      ? "Пока нет вариантов."
      : draft.choices
          .map((c, i) => `${String(i + 1)}. ${c.label} → ${preview(c.answer, 40)}`)
          .join("\n");
  const rows: Btn[][] = [];
  if (draft.choices.length > 0) {
    rows.push([
      { label: `✅ Готово (${String(draft.choices.length)})`, data: encodeCb("npcd") },
    ]);
  }
  rows.push(cancelRow());
  return {
    text:
      "🔘 Кнопки-варианты\n\n" +
      "Пришли вариант в формате «метка | ответ» (ответ покажется попапом при нажатии). " +
      "Добавляй по одному; когда хватит — нажми «Готово».\n\n" +
      list,
    keyboard: buildKeyboard(rows),
  };
}

/** Экран выбора пула для button_prediction (пулы кнопок канала). */
export async function renderNewPostPools(deps: AdminDeps): Promise<Screen> {
  const channel = await resolveSelectedChannel(deps);
  if (channel === null) {
    return noChannelScreen();
  }
  const [pools, meta] = await Promise.all([
    listButtonPools(deps.prisma, channel.id),
    getButtonPoolMeta(deps.prisma, channel.id),
  ]);
  if (pools.length === 0) {
    return {
      text:
        "🔮 Нет пулов кнопок-предсказаний.\n\nСначала создай пул в разделе " +
        "«🔘 Кнопки под постами» или выбери другой тип интерактива.",
      keyboard: buildKeyboard([cancelRow()]),
    };
  }
  const rows: Btn[][] = pools.map((pool, i) => [
    {
      label: `${meta.get(pool.key)?.label ?? pool.key} (${String(pool.count)})`,
      data: encodeCb("nppl", i),
    },
  ]);
  rows.push(cancelRow());
  return {
    text: "🔮 Выбери пул предсказаний для кнопки.",
    keyboard: buildKeyboard(rows),
  };
}

/** Экран выбора источника фото. */
export function renderNewPostPhoto(): Screen {
  const rows: Btn[][] = [
    [{ label: "🔎 Запрос Pexels", data: encodeCb("npph", 0) }],
    [{ label: "📤 Загрузить фото", data: encodeCb("npph", 1) }],
    [{ label: "🚫 Без фото", data: encodeCb("npph", 2) }],
    cancelRow(),
  ];
  return { text: "🖼 Фото поста\n\nВыбери источник фото.", keyboard: buildKeyboard(rows) };
}

/** Экран предпросмотра разового поста перед планированием. */
export function renderNewPostPreview(draft: NewPostDraft, timeZone: string): Screen {
  const body = buildPostMessage({
    title: draft.title ?? "",
    text: draft.text ?? "",
    cta: draft.cta ?? "",
  });
  const interactive =
    draft.interactiveType === undefined
      ? "—"
      : (INTERACTIVE_RU[draft.interactiveType] ?? draft.interactiveType);
  const photo =
    draft.photoFileId !== null
      ? "своё фото"
      : draft.pexelsQuery !== null
        ? `Pexels: ${draft.pexelsQuery}`
        : "без фото";
  const when =
    draft.publishAt === undefined ? "—" : fmtLocalDateTime(draft.publishAt, timeZone);
  const text =
    `👀 Предпросмотр разового поста\n\n${body}\n\n` +
    `— Интерактив: ${interactive}\n— Фото: ${photo}\n— Публикация: ${when} (${timeZone})`;
  return {
    text,
    keyboard: buildKeyboard([
      [{ label: "✅ Запланировать", data: encodeCb("npsave") }],
      cancelRow(),
    ]),
  };
}
