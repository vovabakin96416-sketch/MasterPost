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
 * Точка ряда подписчиков (Шаг 12e-2): дата `YYYY-MM-DD` + число подписчиков
 * на эту дату. Ряд может приходить с дырками и в любом порядке — выводы из
 * него считает чистое ядро `subscriberDynamics.ts`.
 */
export interface SubscriberPoint {
  readonly date: string;
  readonly count: number;
}

/**
 * Провайдер рыночных данных. `channelRef` — публичная ссылка канала
 * (`@username`). Нет данных / ошибка / лимит API → `null`: рыночные фичи
 * гаснут, бот работает как раньше (мягкая деградация, как у Pexels).
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchChannelStat(channelRef: string): Promise<ChannelMarketStat | null>;
  /** Ряд подписчиков по дням за последние ~4 недели (12e-2). */
  fetchSubscriberHistory(
    channelRef: string,
  ): Promise<readonly SubscriberPoint[] | null>;
}
