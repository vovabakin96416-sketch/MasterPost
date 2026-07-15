# RUNBOOK — деплой и восстановление (Railway)

Знание о деплое раньше жило только в дашборде Railway. Этот файл — чтобы не гадать.
Конфигов деплоя в репо НЕТ намеренно: Railway собирает проект авто-детектом (Nixpacks)
по `package.json`.

## Как Railway собирает и запускает

| Фаза | Команда (из `package.json`) | Что делает |
|---|---|---|
| Build | `npm run build` → `prisma generate && tsc` | генерит Prisma Client в `src/generated/prisma`, компилит TS → `dist/` |
| Start | `npm start` → `prisma migrate deploy && node dist/index.js` | **сам применяет миграции**, потом поднимает бота |

Миграции на прод отдельно гонять НЕ надо — `npm start` делает это на каждом деплое.
Транспорт — long polling (вебхук не нужен), поэтому сервис должен быть **always-on**.

## Переменные окружения (Railway → сервис бота → Variables)

**Обязательные** (без них падает zod-валидация в `src/config/env.ts` с понятной ошибкой):
- `BOT_TOKEN` — токен из @BotFather
- `DATABASE_URL` — Postgres. Внутри Railway ссылайся на `${{Postgres.DATABASE_URL}}`
- `ADMIN_ID` — Telegram user id владельца (кому доступно `/menu`)

**Опциональные** (каждая мягко деградирует — без неё фича просто выключена):
- `PEXELS_API_KEY` — подбор фото
- `ANTHROPIC_API_KEY` — AI-посты / AI-ответы / модерация токсичности / AI-пересказ
- `AI_TIMEOUT_MS` — таймаут вызова Claude (иначе `DEFAULT_AI_TIMEOUT_MS`)
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` — MTProto-аналитика (отчёт по просмотрам)
- `TELEMETR_API_KEY` — секция «🌍 Рынок»
- `PORT` (деф. 8000), `LOG_LEVEL` (деф. `info`)

⚠️ `TELEGRAM_SESSION` = полный доступ к личному аккаунту. Только в env, НИКОГДА в git.
⚠️ Одну MTProto-сессию нельзя гонять с двух IP (локально + прод) — Telegram её убьёт.

## Подписка кончилась → сервисы встали

1. **Сначала бэкап БД** (пока проект не удалён — см. ниже). Railway после лапса подписки
   останавливает сервисы, а затем может удалить проект вместе с Postgres.
2. Продлить план: Railway → **Billing** → добавить способ оплаты / вернуть Hobby (~$5/мес).
3. После оплаты сервис часто НЕ поднимается сам — дожать вручную:
   Railway → сервис бота → **Deployments → Redeploy** (или `git commit --allow-empty -m "redeploy" && git push`).
4. Проверить, что env-переменные на месте (при удалении сервиса они теряются).

## Бэкап и восстановление БД

Дамп (строка подключения — **`DATABASE_PUBLIC_URL`** из сервиса Postgres; внутренний
`*.railway.internal` снаружи не резолвится):

```bash
pg_dump "<DATABASE_PUBLIC_URL>" -Fc -f railway-backup-YYYY-MM-DD.dump
```

Восстановление в новую/чистую базу:

```bash
pg_restore -d "<НОВЫЙ_DATABASE_URL>" --clean --if-exists --no-owner railway-backup-YYYY-MM-DD.dump
```

Если данные потеряны безвозвратно — поднять с нуля: `npm start` применит миграции,
затем `npm run seed` зальёт канал №1 (⚠️ сид — данные таро-канала, для чужого канала не тиражировать).

## Проверка, что деплой живой

1. Railway → **Logs**: ждём строку старта бота без стектрейсов; ошибки env читаются с ходу
   («BOT_TOKEN обязателен» и т.п.).
2. В Telegram: `/menu` от `ADMIN_ID` → должно открыться «🤖 Меню управления»
   (быстрые действия сверху + разделы План / Комментарии / Рост / Каналы).
3. Автопостинг тикает раз в минуту; снимок охвата — 22:00 МСК, отчёт — ПН 09:30 МСК.

## Если решишь уехать с Railway

Нужен always-on процесс (long polling) + Postgres. Рабочая связка: Postgres → Neon/Supabase
(бесплатный тариф), процесс → Fly.io / Koyeb / дешёвый VPS. Понадобится `Dockerfile`
(сейчас его нет — Railway обходился Nixpacks): Node 20+, `npm ci`, `npm run build`, `npm start`.
