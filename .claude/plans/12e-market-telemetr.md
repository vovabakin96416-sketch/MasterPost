# План 12e — Рыночные данные (Telemetr) за адаптером MarketDataProvider

## Контекст
12a–12d показывают, что происходит ВНУТРИ канала (MTProto, бесплатно). 12e добавляет
взгляд СНАРУЖИ через Telemetr API. Решение 12a: платный сервис — НЕ фундамент, а
опциональный слой за адаптером с мягкой деградацией (без ключа всё работает как раньше).

⚠️ Ключ: владелец решил НЕ перевыпускать засвеченный ключ («пока устраивает»).
Ключ живёт ТОЛЬКО в env (`TELEMETR_API_KEY`), не в коде и не в git.

## Что известно про API (проверено живым вызовом через MCP владельца)
- База `https://api.telemetr.me`, авторизация `Authorization: Bearer <token>`,
  `Accept: application/json`.
- **`GET /channels/stat?channelId=@username`** → `{ status: "ok", response: {
  participants_count, avg_post_reach, err_percent, daily_reach, mentions_count,
  posts_count, forwards_per_post, scoring_rate, … } }` (реальный ответ для
  @sofia_gada1ka получен, форма подтверждена).
- Ошибки: не-2xx (в т.ч. 429 при лимите), либо `status != "ok"`.
- Лимит тарифа: 10k запросов/мес — жечь на каждое открытие экрана нельзя → кэш.

## Скоуп 12e-1 (этот шаг) — ОДНА метрика в ОДНОМ месте
Метрика v1: **внешний взгляд Telemetr на СВОЙ канал** (`/channels/stat`) — подписчики,
охват поста, ERR по Telemetr, упоминания. Один вызов API. Место вывода: секция
«🌍 Рынок» в конце экрана «📈 Рост». Еженедельный отчёт, похожие каналы,
динамика подписчиков, бенчмарк ниши — **12e-2**.

## Кэш (без миграции)
`Setting` канала, ключ `market_stat_cache` = JSON `{ fetchedAt: ISO, stat: {...} }`,
TTL **12 часов**. Свежий кэш → 0 запросов к API. Протухший → запрос; ошибка запроса →
показываем протухший кэш (лучше старые данные, чем ничего), совсем пусто → секции нет.

## Файлы
1. `src/config/env.ts` — `TELEMETR_API_KEY: z.string().optional()` (как PEXELS_API_KEY).
2. `src/core/market/marketData.ts` — ЧИСТОЕ ядро: тип `ChannelMarketStat`
   (subscribers, avgPostReach, errPercent, dailyReach, mentionsCount), интерфейс
   `MarketDataProvider { fetchChannelStat(ref): Promise<ChannelMarketStat|null> }`.
3. `src/core/market/marketCache.ts` — zod-схема кэша, `parseMarketCache` (кривое → null),
   `isCacheFresh(fetchedAt, now, ttl)`, `MARKET_CACHE_TTL_MS`.
4. `src/core/market/marketSection.ts` — `buildMarketSection(stat, own)` → плейн-текст
   секции «🌍 Рынок» БЕЗ Markdown-эмфазы (правило 12c: тот же текст пойдёт в
   `editMessageText` без parse_mode). `own` = свой ERR за 7д из последнего снимка
   (сравнение «по Telemetr X% / свой расчёт Y%»).
5. `src/services/market/telemetrProvider.ts` — тонкий HTTP-адаптер:
   `createTelemetrProvider({ apiKey, logger, fetchFn?, timeoutMs? })` →
   `MarketDataProvider | null` (нет ключа → null). zod-safeParse ответа; не-2xx /
   `status!="ok"` / кривой JSON / сеть / таймаут → null + warn (бот не падает).
6. `src/services/market/marketStatService.ts` — оркестратор с кэшем:
   `buildMarketSectionText(prisma, logger, channel, provider, now?)` → string | null.
   Ссылка канала: `@username`, иначе `chatId` если начинается с `@`, иначе null (нет
   способа спросить Telemetr → секции нет). Свой ERR — из `getLatestStatSnapshot`.
7. Вживление: `BotDeps`/`AdminDeps` += `telemetrApiKey`, `index.ts` прокидывает;
   `renderGrowth` (screens.ts) добавляет секцию ПОСЛЕ отчёта/нарратива (в AI-пересказ
   рыночные данные не скармливаем — 0 новых токенов).

## Тесты (`tests/market.test.ts`, ~12)
- `buildMarketSection`: полные данные / без own / нет `*` и `_` в выводе.
- `marketCache`: свежий / протухший / кривой JSON → null.
- `telemetrProvider` (инъекция fetchFn): ok → распарсено; `status:"error"` → null;
  HTTP 429 → null; кривой JSON → null; сеть бросает → null; без ключа → провайдер null.

## Не делаем (12e-2 и дальше)
Похожие каналы, динамика подписчиков, бенчмарк ниши, секция в еженедельном отчёте,
свой индекс Telegram, вет чужих каналов (скилл telemetr-vetting), новые AI-вызовы,
миграции БД.

## Проверки
typecheck + lint + vitest + build → запись в ARCHIVE-PROGRESS → шапка STATE.md → коммит + пуш.
