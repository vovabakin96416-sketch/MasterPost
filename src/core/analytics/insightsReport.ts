/**
 * Форматтер отчёта Content Intelligence (Шаг 12c) — ЧИСТАЯ логика (без Telegram/БД).
 *
 * Превращает факты ядра (`Insights`) + рекомендации советника (`Advice`) + нативные
 * часы в человекочитаемый текст «что зашло / что провалилось / лучшее время / тренд
 * охвата / рекомендации». Как `buildWeeklyReport` (7c) — здесь только сборка строк.
 *
 * ⚠️ БЕЗ Markdown-эмфазы (`*`/`_`): тот же текст идёт и в еженедельный отчёт (Markdown-
 * сообщение), и на экран «📈 Рост» (editMessageText БЕЗ parse_mode). Эмодзи + структура
 * читаются одинаково в обоих местах; звёздочки/подчерки в плейн-тексте выглядели бы сором.
 */

import type { Insights, RankedPost } from "./insights.js";
import type { Advice } from "./advisor.js";
import type { Slot } from "./dimensions.js";
import type { Weekday } from "../schedule/localDate.js";

/** Заголовок раздела (виден и в отчёте, и на экране «Рост»). */
const HEADER = "📈 Рост канала";

/** Дни недели по-русски (родительный/для фразы «в пятницу»). */
const WEEKDAY_RU: Record<Weekday, string> = {
  monday: "понедельник",
  tuesday: "вторник",
  wednesday: "среда",
  thursday: "четверг",
  friday: "пятница",
  saturday: "суббота",
  sunday: "воскресенье",
};

/** Часть суток по-русски. */
const SLOT_RU: Record<Slot, string> = { morning: "утро", evening: "вечер" };

/** Бакеты длины по-русски. */
const LENGTH_RU: Record<"short" | "medium" | "long", string> = {
  short: "короткие",
  medium: "средние",
  long: "длинные",
};

/** ERR (доля 0..1) → «7.0%». */
function pct(err: number): string {
  return `${(err * 100).toFixed(1)}%`;
}

/** «понедельник, утро». */
function slotLabel(weekday: Weekday, slot: Slot): string {
  return `${WEEKDAY_RU[weekday]}, ${SLOT_RU[slot]}`;
}

/** Чистит превью поста: сворачивает пробелы, убирает `*`/`_` (ломают Markdown), режет. */
function cleanPreview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").replace(/[*_]/g, "").trim();
  return flat.length > max ? flat.slice(0, max) : flat;
}

/** Строка про пост (лучший/худший): превью + ERR. */
function postLine(ranked: RankedPost): string {
  const preview = cleanPreview(ranked.post.preview, 50);
  return `«${preview}…» — вовлечённость ${pct(ranked.err)}`;
}

/** Час канала «19:00». */
function hourLabel(hour: number): string {
  return `${hour < 10 ? "0" : ""}${String(hour)}:00`;
}

/** Одна рекомендация советника → русская строка-буллет (без ведущего маркера). */
function adviceLine(advice: Advice): string {
  switch (advice.kind) {
    case "not_enough_data":
      return advice.count === 0
        ? "Постов за период не было — данных для выводов пока нет."
        : `Пока мало постов (${String(advice.count)}) — выводы появятся, когда наберётся статистика.`;
    case "best_slot":
      return `Публикуй в «${slotLabel(advice.weekday, advice.slot)}» — там лучший отклик (${pct(advice.avgErr)}).`;
    case "worst_slot":
      return `Слабее всего заходит «${slotLabel(advice.weekday, advice.slot)}» (${pct(advice.avgErr)}) — стоит пересмотреть.`;
    case "native_hours": {
      const hours = advice.hours.map(hourLabel).join(", ");
      return advice.matchesOwn
        ? `Нативная стата Telegram подтверждает: аудитория активнее всего в ${hours} — совпадает с твоим лучшим слотом.`
        : `Нативная стата Telegram: аудитория активнее всего в ${hours} — это расходится с твоим лучшим слотом, стоит попробовать.`;
    }
    case "trend": {
      const dir =
        advice.direction === "up"
          ? "растёт 📈"
          : advice.direction === "down"
            ? "падает 📉"
            : "держится ровно ➡️";
      const parts = [`Охват ${dir}`];
      if (advice.viewsDeltaPct !== null) {
        const sign = advice.viewsDeltaPct >= 0 ? "+" : "";
        parts.push(`(${sign}${advice.viewsDeltaPct.toFixed(0)}% просмотров к прошлой неделе)`);
      }
      if (advice.subscribersDelta !== null && advice.subscribersDelta !== 0) {
        const sign = advice.subscribersDelta > 0 ? "+" : "";
        parts.push(`· подписчиков ${sign}${String(advice.subscribersDelta)}`);
      }
      return `${parts.join(" ")}.`;
    }
    case "content_media":
      return advice.prefer === "with"
        ? `Посты с фото/видео заходят лучше (${pct(advice.withErr)} против ${pct(advice.withoutErr)}) — добавляй медиа.`
        : `Посты без медиа заходят лучше (${pct(advice.withoutErr)} против ${pct(advice.withErr)}) — текст решает.`;
    case "content_buttons":
      return advice.prefer === "with"
        ? `Кнопки под постом повышают вовлечённость (${pct(advice.withErr)} против ${pct(advice.withoutErr)}).`
        : `Без кнопок отклик выше (${pct(advice.withoutErr)} против ${pct(advice.withErr)}) — не перегружай.`;
    case "content_length":
      return `Лучше всего заходят ${LENGTH_RU[advice.best]} тексты (${pct(advice.avgErr)}).`;
    case "outliers":
      return `⚠️ ${String(advice.count)} пост(ов) — виральный/рекламный залёт, в выводах не учтён (не показатель контента).`;
  }
}

/** Строит раздел «лучшее время»: свои слоты (топ-3) + нативные часы Telegram. */
function bestTimeSection(
  insights: Insights,
  nativeTopHoursLocal: readonly number[],
): string[] {
  const lines = ["🕐 Лучшее время"];
  if (insights.bestTimes.length === 0) {
    lines.push("Своих данных по времени пока нет.");
  } else {
    for (const cell of insights.bestTimes.slice(0, 3)) {
      lines.push(`• ${slotLabel(cell.weekday, cell.slot)} — ${pct(cell.avgErr)}`);
    }
  }
  if (nativeTopHoursLocal.length > 0) {
    const hours = nativeTopHoursLocal.slice(0, 3).map(hourLabel).join(", ");
    lines.push(`📡 Нативно (Telegram): активнее всего в ${hours} по времени канала.`);
  }
  return lines;
}

/**
 * Собирает текст отчёта Content Intelligence. Пустые данные (нет постов) → понятная
 * заглушка. Часовой пояс уже «зашит» в данные выше: слоты лучшего времени посчитаны в
 * поясе канала (`buildInsights`), нативные часы приведены к нему сервисом.
 */
export function buildInsightsReport(
  insights: Insights,
  advice: readonly Advice[],
  nativeTopHoursLocal: readonly number[],
): string {
  if (insights.count === 0) {
    return `${HEADER}\n\nПостов за последние 7 дней не найдено — выводы появятся, когда пойдут публикации.`;
  }

  const blocks: string[] = [HEADER];

  // Что зашло / что провалилось.
  if (insights.best !== null) {
    blocks.push(`🔥 Что зашло\n${postLine(insights.best)}`);
  }
  if (insights.worst !== null && insights.worst.post.messageId !== insights.best?.post.messageId) {
    blocks.push(`❄️ Что провалилось\n${postLine(insights.worst)}`);
  }

  // Лучшее время (свои слоты + нативные часы).
  blocks.push(bestTimeSection(insights, nativeTopHoursLocal).join("\n"));

  // Рекомендации советника.
  if (advice.length > 0) {
    const bullets = advice.map((a) => `• ${adviceLine(a)}`).join("\n");
    blocks.push(`💡 Рекомендации\n${bullets}`);
  }

  return blocks.join("\n\n");
}
