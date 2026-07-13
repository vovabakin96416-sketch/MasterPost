# План 12e-2 — Рыночные данные (Telemetr): динамика подписчиков + секция в отчёте

## Контекст
12e-1 дал фундамент: env-ключ, адаптер `MarketDataProvider` (Telemetr), кэш в `Setting`
(TTL 12ч), одна метрика (`/channels/stat`) в одном месте (секция «🌍 Рынок» на экране
«📈 Рост»). 12e-2 добавляет метрики и второе место вывода по тому же паттерну.

## Разведка (живые вызовы через MCP, 2026-07-12)
- **`GET /channels/subscribers?channelId=@X&group=day&start_date=…&end_date=…`** →
  `{ status:"ok", response:[{ date:"YYYY-MM-DD", participantsCount:number }, …] }`,
  НОВЫЕ СВЕРХУ. ⚠️ Окно ровно в 1 месяц → HTTP 400 «Неверный интервал дат»;
  **28 дней работает** (проверено). Без дат → только сегодня. Формат дат
  `YYYY-MM-DD HH:MM:SS`.
- **`GET /v1/channels/similar`** — при разведке ДВАЖДЫ упал по таймауту; плюс
  документированный риск 429 по тарифу. Ненадёжен → НЕ берём в 12e-2.
- Лимиты (`/v1/limits`): 9951/10000 запросов — запас есть, кэш всё равно держим.

## Скоуп 12e-2 (выбор владельца)
1. **Динамика подписчиков** (`/channels/subscribers`, group=day, окно 28 дней) —
   сигнал «канал растёт/сохнет снаружи»: Δ за 7 дней и Δ за 28 дней + стрелка
   тренда. Одна строка в секции «🌍 Рынок».
2. **Второе место вывода**: та же секция «🌍 Рынок» в еженедельном отчёте —
   реюз `buildMarketSectionText`, ноль нового форматирования.

**Не делаем (→ 12e-3 при желании):** похожие каналы (таймауты + 429), бенчмарк ниши
(ER похожих = N+1 запросов, зависит от similar), свой индекс, вет чужих каналов,
AI-вызовы (весь 12e = 0 токенов), миграции БД (кэш — в `Setting`).

## Бюджет запросов
Полное обновление среза = **2 запроса** (`stat` + `subscribers`) раз в 12ч на канал.
≈ 4 запроса/сутки — капля от лимита 10k/мес.

## Файлы
1. `src/core/market/marketData.ts` — тип `SubscriberPoint { date, count }`;
   `MarketDataProvider` += `fetchSubscriberHistory(channelRef): Promise<readonly SubscriberPoint[] | null>`.
2. `src/core/market/subscriberDynamics.ts` (НОВОЕ ядро, чистое) —
   `computeSubscriberDynamics(points, now)` → `{ current, delta7d, delta28d } | null`
   (пустой/односторонний ряд → null; берём ближайшую к границе точку — ряд может
   быть с дырками). Константа окна `SUBSCRIBER_WINDOW_DAYS = 28`.
3. `src/core/market/marketCache.ts` — схема кэша += ОПЦИОНАЛЬНОЕ поле
   `subscribers: SubscriberPoint[]` (старый кэш 12e-1 без поля остаётся валидным —
   обратная совместимость, миграции нет).
4. `src/core/market/marketSection.ts` — `buildMarketSection(stat, own, dynamics?)`:
   при наличии динамики строка вида
   `📈 Подписчики за 7д: +3 · за 28д: +14` (знак всегда, «сохнет» видно по минусу).
   По-прежнему БЕЗ Markdown-эмфазы (правило 12c).
5. `src/services/market/telemetrProvider.ts` — `fetchSubscriberHistory`: zod-схема
   ответа, окно = последние 28 дней от `now`, формат дат `YYYY-MM-DD HH:MM:SS`;
   те же правила деградации: не-2xx / `status!="ok"` / кривой JSON / сеть → null + warn.
6. `src/services/market/marketStatService.ts` — `getMarketStat` тянет ОБА среза при
   протухании кэша (упал только subscribers → пишем stat без динамики, строки просто
   нет); `buildMarketSectionText` передаёт динамику в форматтер.
7. Отчёт: `WeeklyReportDeps` += `telemetrApiKey?` (паттерн `anthropicApiKey` 12d);
   в `collectReport` после нарратива — `buildMarketSectionText` (провайдер создаётся
   на месте, как на экране «Рост»); null → отчёт как раньше. Прокинуть в
   `scheduler/analytics.ts` и тест-кнопке `anrep` (`index.ts` уже читает env).

## Тесты (`tests/market.test.ts`, ~10 новых)
- `computeSubscriberDynamics`: рост / отток / ряд с дырками / пустой или
  одноточечный → null.
- `marketSection`: строка динамики есть/нет, знак `+`/`-`, нет `*`/`_`.
- `marketCache`: старый кэш 12e-1 (без subscribers) валиден; новый — парсится.
- `telemetrProvider.fetchSubscriberHistory` (fetchFn-инъекция): ok → массив;
  HTTP 400/429 → null; кривой JSON → null.
- сервис: subscribers упал → секция без строки динамики (stat живёт).

## Проверки
typecheck + lint + vitest + build → запись в ARCHIVE-PROGRESS → шапка STATE.md → коммит + пуш.
