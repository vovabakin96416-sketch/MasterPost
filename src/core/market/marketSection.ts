import type { ChannelMarketStat } from "./marketData.js";
import type { SubscriberAnomaly } from "./subscriberAnomaly.js";
import type { SubscriberDynamics } from "./subscriberDynamics.js";

/**
 * Форматтер секции «🌍 Рынок» (Шаг 12e) — ЧИСТАЯ логика (без Telegram/БД/HTTP).
 *
 * Показывает, как канал выглядит СНАРУЖИ (данные `MarketDataProvider`) рядом со
 * своими метриками MTProto. ⚠️ БЕЗ Markdown-эмфазы (`*`/`_`) — правило 12c: текст
 * идёт на экран «📈 Рост» (editMessageText БЕЗ parse_mode).
 */

/** Свои метрики для сравнения с рыночными (из последнего снимка охвата, 12b). */
export interface OwnMetrics {
  /** Свой ERR за 7 дней — доля 0..1 (как считает ядро 12a), не проценты. */
  readonly avgErr7d: number | null;
}

/** Процент с одним знаком: 6.51 → «6.5%». */
function pctFromPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Дельта со знаком всегда: рост «+3», отток «-2» — «сохнет» видно сразу. */
function signed(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/** Строка динамики подписчиков (12e-2); нет ни одной дельты → строки нет. */
function dynamicsLine(dynamics: SubscriberDynamics | null): string | null {
  if (dynamics === null) {
    return null;
  }
  const parts: string[] = [];
  if (dynamics.delta7d !== null) {
    parts.push(`за 7д: ${signed(dynamics.delta7d)}`);
  }
  if (dynamics.delta28d !== null) {
    parts.push(`за 28д: ${signed(dynamics.delta28d)}`);
  }
  return parts.length === 0 ? null : `📈 Подписчики ${parts.join(" · ")}`;
}

/** Сколько дат аномалий показываем в строке — дальше «…» (строка не резиновая). */
const ANOMALY_DATES_SHOWN = 3;

/** Дата `YYYY-MM-DD` → «ДД.ММ» для владельца. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** Строка-предупреждение о резких скачках подписчиков (12f); нет аномалий → нет строки. */
function anomalyLine(anomalies: readonly SubscriberAnomaly[]): string | null {
  if (anomalies.length === 0) {
    return null;
  }
  const dates = anomalies.slice(0, ANOMALY_DATES_SHOWN).map((a) => shortDate(a.date));
  const suffix = anomalies.length > ANOMALY_DATES_SHOWN ? "…" : "";
  return `⚠️ Резкие скачки подписчиков: ${String(anomalies.length)} за 28д (${dates.join(", ")}${suffix}) — возможна накрутка или рекламный всплеск`;
}

/**
 * Собирает текст секции «🌍 Рынок». Если у владельца есть свой ERR (снимок 12b),
 * рядом с рыночным показывается сравнение — иначе только внешние цифры.
 * `dynamics` (12e-2) — рост/отток подписчиков; нет данных → строки просто нет.
 * `anomalies` (12f) — резкие скачки ряда; пусто → предупреждения нет.
 */
export function buildMarketSection(
  stat: ChannelMarketStat,
  own: OwnMetrics,
  dynamics: SubscriberDynamics | null = null,
  anomalies: readonly SubscriberAnomaly[] = [],
): string {
  const lines = ["🌍 Рынок (Telemetr)"];
  lines.push(
    `👥 Подписчиков: ${String(stat.subscribers)} · охват поста: ~${String(stat.avgPostReach)} · за день: ${String(stat.dailyReach)}`,
  );
  const growth = dynamicsLine(dynamics);
  if (growth !== null) {
    lines.push(growth);
  }
  const warning = anomalyLine(anomalies);
  if (warning !== null) {
    lines.push(warning);
  }
  const err = `📊 ERR по Telemetr: ${pctFromPercent(stat.errPercent)}`;
  lines.push(
    own.avgErr7d === null
      ? err
      : `${err} (свой расчёт за 7 дней: ${pctFromPercent(own.avgErr7d * 100)})`,
  );
  lines.push(`📣 Упоминаний другими каналами: ${String(stat.mentionsCount)}`);
  return lines.join("\n");
}
