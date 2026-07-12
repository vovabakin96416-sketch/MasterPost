/**
 * Типы рыночных данных (Шаг 12e) — ЧИСТОЕ ядро, без HTTP/БД/Telegram.
 *
 * Решение 12a (риск №4): платный сторонний сервис — НИКОГДА не фундамент.
 * Весь рыночный слой спрятан за интерфейсом `MarketDataProvider`: ядро и меню
 * зависят от него, а не от Telemetr. Позже адаптер можно заменить на TGStat
 * или свой MTProto-сбор — остальной код не меняется (как `MediaProvider` 6a).
 */

/**
 * Внешний взгляд на канал глазами рынка (v1 — из `/channels/stat` Telemetr):
 * как канал видят рекламодатели и каталоги, в отличие от внутренних метрик MTProto.
 */
export interface ChannelMarketStat {
  /** Подписчики по данным сервиса. */
  readonly subscribers: number;
  /** Средний охват поста. */
  readonly avgPostReach: number;
  /** ERR в процентах (0..100), как считает сервис — не наша доля 0..1. */
  readonly errPercent: number;
  /** Суточный охват канала. */
  readonly dailyReach: number;
  /** Сколько раз канал упоминали другие каналы. */
  readonly mentionsCount: number;
}

/**
 * Провайдер рыночных данных. `channelRef` — публичная ссылка канала
 * (`@username`). Нет данных / ошибка / лимит API → `null`: рыночные фичи
 * гаснут, бот работает как раньше (мягкая деградация, как у Pexels).
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchChannelStat(channelRef: string): Promise<ChannelMarketStat | null>;
}
