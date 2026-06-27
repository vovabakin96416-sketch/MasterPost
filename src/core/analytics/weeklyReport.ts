/**
 * Аналитика канала, часть «еженедельный отчёт по просмотрам» (Шаг 7c) — ЧИСТАЯ логика.
 *
 * Порт сборки текста `analytics.py:weekly_stats_report`: по каждому посту за прошлую
 * неделю — просмотры/реакции/комменты, затем итоги и лучший пост. Здесь только
 * форматирование и агрегация; чтение метрик (через личный аккаунт/GramJS), запись в БД
 * и отправка живут выше (сервис), чтобы core не зависел от GramJS/БД/Telegram.
 */

/** Метрики одного поста (плоский тип — GramJS-типы наружу не «протекают»). */
export interface PostMetricInput {
  readonly messageId: number;
  readonly views: number;
  readonly reactions: number;
  readonly replies: number;
  readonly preview: string;
  readonly postedAt: Date;
}

/** До скольких символов режем сырое превью при чтении (отчёт обрежет ещё короче). */
const RAW_PREVIEW_LENGTH = 80;

/**
 * Минимальная форма GramJS-сообщения, которую читает отчёт. Чистый структурный тип —
 * НЕ тянет GramJS, поэтому маппинг можно тестировать в изоляции (принцип 7b).
 */
export interface RawMessageLike {
  readonly id: number;
  /** Unix-секунды публикации (как `msg.date` в GramJS). */
  readonly date: number;
  /** Текст/подпись поста; у медиа без подписи и служебных сообщений бывает undefined. */
  readonly message?: string | undefined;
  /** Любое медиа (фото/видео…); undefined → текстовый или служебный пост. */
  readonly media?: unknown;
  readonly views?: number | undefined;
  readonly reactions?:
    | { readonly results: readonly { readonly count: number }[] }
    | undefined;
  readonly replies?: { readonly replies: number } | undefined;
}

/**
 * Маппит одно сообщение канала в плоскую метрику; `null` для служебных сообщений (нет ни
 * текста, ни медиа — их в отчёт не берём).
 *
 * ⚠️ `message` бывает `undefined` (например, фото без подписи) — берём `?? ""`, иначе
 * `.slice` падает с «Cannot read properties of undefined (reading 'slice')». Чисто и под тестами.
 */
export function messageToMetric(msg: RawMessageLike): PostMetricInput | null {
  const text = msg.message ?? "";
  if (text === "" && msg.media === undefined) {
    return null;
  }
  const reactions =
    msg.reactions?.results.reduce((sum: number, r) => sum + r.count, 0) ?? 0;
  return {
    messageId: msg.id,
    views: msg.views ?? 0,
    reactions,
    replies: msg.replies?.replies ?? 0,
    preview: text.slice(0, RAW_PREVIEW_LENGTH),
    postedAt: new Date(msg.date * 1000),
  };
}

/** Агрегированные итоги недели (числа отдельно от текста — удобно тестировать). */
export interface WeeklySummary {
  readonly count: number;
  readonly totalViews: number;
  readonly avgViews: number;
  readonly totalReactions: number;
  readonly best: PostMetricInput | null;
}

/** Сколько символов превью поста показываем в строке отчёта (как `[:50]` в Python). */
const PREVIEW_LIMIT = 50;
/** Превью лучшего поста чуть длиннее (как `[:60]` в Python). */
const BEST_PREVIEW_LIMIT = 60;

/** Чистит текст для подписи: убирает переносы и `*` (ломают Markdown), обрезает. */
function cleanPreview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").replace(/\*/g, "").trim();
  return flat.length > max ? flat.slice(0, max) : flat;
}

/** Считает итоги недели: суммы, среднее (floor) и лучший пост по просмотрам. */
export function summariseWeekly(metrics: readonly PostMetricInput[]): WeeklySummary {
  let totalViews = 0;
  let totalReactions = 0;
  let best: PostMetricInput | null = null;
  for (const m of metrics) {
    totalViews += m.views;
    totalReactions += m.reactions;
    if (best === null || m.views > best.views) {
      best = m;
    }
  }
  const count = metrics.length;
  return {
    count,
    totalViews,
    avgViews: count > 0 ? Math.floor(totalViews / count) : 0,
    totalReactions,
    best,
  };
}

/** Форматирует дату публикации как `дд.мм ЧЧ:ММ` в поясе канала (порт `%d.%m %H:%M`). */
function formatPostDate(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("day")}.${pick("month")} ${pick("hour")}:${pick("minute")}`;
}

/**
 * Собирает текст отчёта за неделю (Markdown, как Python-бот). Посты сортируем по дате
 * по возрастанию (хронологический порядок — как `posts.reverse()` в Python). Пустой
 * список → понятная заглушка.
 */
export function buildWeeklyReport(
  metrics: readonly PostMetricInput[],
  tz: string,
): string {
  const header = "📊 *Аналитика за прошлую неделю*";
  if (metrics.length === 0) {
    return `${header}\n\nПостов за последние 7 дней не найдено.`;
  }

  const sorted = [...metrics].sort(
    (a, b) => a.postedAt.getTime() - b.postedAt.getTime(),
  );

  const lines: string[] = [`${header}\n`];
  for (const m of sorted) {
    const dateStr = formatPostDate(m.postedAt, tz);
    const preview = cleanPreview(m.preview, PREVIEW_LIMIT);
    lines.push(
      `📅 ${dateStr}\n` +
        `👁 ${String(m.views)} · ❤️ ${String(m.reactions)} · 💬 ${String(m.replies)}\n` +
        `_${preview}…_\n`,
    );
  }

  const s = summariseWeekly(sorted);
  lines.push(
    "───────────────\n" +
      "📈 *Итого за неделю:*\n" +
      `Постов: ${String(s.count)}\n` +
      `Просмотров: ${String(s.totalViews)} (среднее: ${String(s.avgViews)})\n` +
      `Реакций: ${String(s.totalReactions)}\n`,
  );

  if (s.best !== null) {
    const bestPreview = cleanPreview(s.best.preview, BEST_PREVIEW_LIMIT);
    lines.push(
      `🏆 *Лучший пост:* _${bestPreview}…_\n👁 ${String(s.best.views)} просмотров`,
    );
  }

  return lines.join("\n");
}
