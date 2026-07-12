import type { ChannelMarketStat } from "./marketData.js";

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

/**
 * Собирает текст секции «🌍 Рынок». Если у владельца есть свой ERR (снимок 12b),
 * рядом с рыночным показывается сравнение — иначе только внешние цифры.
 */
export function buildMarketSection(
  stat: ChannelMarketStat,
  own: OwnMetrics,
): string {
  const lines = ["🌍 Рынок (Telemetr)"];
  lines.push(
    `👥 Подписчиков: ${String(stat.subscribers)} · охват поста: ~${String(stat.avgPostReach)} · за день: ${String(stat.dailyReach)}`,
  );
  const err = `📊 ERR по Telemetr: ${pctFromPercent(stat.errPercent)}`;
  lines.push(
    own.avgErr7d === null
      ? err
      : `${err} (свой расчёт за 7 дней: ${pctFromPercent(own.avgErr7d * 100)})`,
  );
  lines.push(`📣 Упоминаний другими каналами: ${String(stat.mentionsCount)}`);
  return lines.join("\n");
}
