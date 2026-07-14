import type { Logger } from "pino";
import type { MarketDataProvider } from "../../core/market/marketData.js";
import {
  buildVettingReport,
  vetChannelStat,
} from "../../core/market/channelVetting.js";
import { detectSubscriberAnomalies } from "../../core/market/subscriberAnomaly.js";
import { computeSubscriberDynamics } from "../../core/market/subscriberDynamics.js";

/**
 * Оркестратор вета чужого канала (Шаг 12g): нормализация ссылки → провайдер
 * Telemetr (стата + ряд подписчиков) → ядро вета → плейн-текст для экрана.
 *
 * БЕЗ кэша (в отличие от рыночной секции своего канала 12e): чужой канал не
 * имеет строки `Channel` в БД, а вет — по требованию и редкий (владелец жмёт
 * вручную перед закупкой). 2 запроса Telemetr на проверку; лимит 10k/мес держит.
 * Мягкая деградация: нет ключа → `no_key`; канал приватный/не найден/API упал →
 * `not_found` (не исключение).
 */

/** Результат вета для Telegram-слоя: понятный union вместо исключений. */
export type VettingOutcome =
  | { readonly kind: "no_key" }
  | { readonly kind: "bad_ref" }
  | { readonly kind: "not_found"; readonly ref: string }
  | { readonly kind: "ok"; readonly ref: string; readonly text: string };

/**
 * Нормализует ввод владельца в `@username`. Принимает `@username`, `username`,
 * `t.me/username`, `https://t.me/x`, `telemetr.me/@x`. Возвращает `null`, если
 * имя не похоже на публичный username (Telegram: 5–32 симв., буквы/цифры/`_`).
 * Приватную числовую ссылку (`t.me/c/…`) вет не поддерживает — API нужен @-ник.
 */
export function normalizeChannelRef(raw: string): string | null {
  let s = raw.trim();
  // Отрезаем схему и известные хосты, оставляя «хвост» с username.
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^(?:www\.)?(?:t\.me|telegram\.me|telemetr\.me)\//i, "");
  s = s.replace(/^@/, "");
  // Берём первый сегмент до слэша/пробела/вопроса (обрезаем хвосты ссылок).
  const first = s.split(/[/?\s]/)[0] ?? "";
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(first)) {
    return null;
  }
  return `@${first}`;
}

/** Провайдер для вета: строим тот же адаптер Telemetr, что и секция рынка (12e). */
export interface VettingDeps {
  readonly logger: Logger;
  readonly provider: MarketDataProvider | null;
}

/**
 * Проверяет чужой канал: нормализует ссылку, тянет расширенный срез + ряд
 * подписчиков, считает вердикт и собирает текст. Нет провайдера → `no_key`;
 * кривая ссылка → `bad_ref`; API не отдал стату → `not_found`.
 */
export async function vetChannel(
  deps: VettingDeps,
  rawRef: string,
  now: Date = new Date(),
): Promise<VettingOutcome> {
  if (deps.provider === null) {
    return { kind: "no_key" };
  }
  const ref = normalizeChannelRef(rawRef);
  if (ref === null) {
    return { kind: "bad_ref" };
  }
  const stat = await deps.provider.fetchChannelVetting(ref);
  if (stat === null) {
    return { kind: "not_found", ref };
  }
  // Ряд подписчиков — второй запрос; упал → тренд/аномалии просто не участвуют.
  const series = await deps.provider.fetchSubscriberHistory(ref);
  const dynamics = series === null ? null : computeSubscriberDynamics(series, now);
  const anomalies = series === null ? [] : detectSubscriberAnomalies(series);
  const result = vetChannelStat(stat, dynamics, anomalies);
  return { kind: "ok", ref, text: buildVettingReport(ref, stat, result) };
}
