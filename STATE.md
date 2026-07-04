# STATE — текущее состояние

> Короткий файл. Читается в начале сессии. История по шагам — в `docs/ARCHIVE-PROGRESS.md` (на запрос).

## 🔜 Сейчас
Шаг 10b готов — **AI-пост → очередь одобрения + кнопка в меню** (продукт поверх фундамента
10a). Админ жмёт «🤖 AI-пост» → бот пишет пост голосом канала → кладёт его в ту же очередь
одобрения, что и плановый пост, так что «✅ Опубликовать» / «✍️ Изменить текст» / «🔄 Другое
фото» работают без правок. Что сделано:
- миграция `PendingPost.pexelsQuery` (`20260704073430_...`) + проведена через `pendingPostRepository`;
- `postingService`: `ApprovalDraft` + `requestApprovalForDraft` — единый путь очереди (плановый
  и AI); `requestApproval(post)` стал тонкой обёрткой (плановое поведение прежнее);
- `services/ai/aiPostApprovalService` (`requestAiPostApproval`): ключ→канал→`getSamplePosts`→
  `generatePostDraft`→очередь; результат-union `{no_key|no_channel|no_samples|gen_failed}` →
  понятный тост, не исключение;
- починка «🔄 Другое фото» для AI-постов (`handleReroll`: fallback на `pending.pexelsQuery`);
- кнопка «🤖 AI-пост» (широкая строка `MAIN_SECTIONS`, callback `aigen`) + хендлер;
- проброс `ANTHROPIC_API_KEY`: `index.ts` → `BotDeps` → `AdminDeps`.
⚠️ Прод-нюанс: кнопка сгенерирует пост только с `ANTHROPIC_API_KEY` в env Railway (без ключа —
сообщение-подсказка, без падения). Миграцию `pexelsQuery` на Railway применит `prisma migrate
deploy` (в `npm start`) сам.
⚠️ Прод-шаги MTProto-хотфикса всё ещё за пользователем: `npm run gen-session` → обновить
`TELEGRAM_SESSION` на Railway → redeploy → `/start` боту. Не гонять одну сессию с двух IP.
Дальше — Шаг 11 (AI-ответы в комментах) либо доводка 10 (ввод темы поста в мастер AI).

Отложено: шифрование bot-токенов клиентов + мультибот-форк (остаток Шага 9 — нужно поле
`Channel.botToken` и раннер на токен; имеет смысл только в настоящем мультитенанте, отдельный план);
мультиканальная аналитика (еженедельный отчёт). Пер-постовые ответные комменты не делаем —
триггеры остаются ГЛОБАЛЬНОЙ настройкой канала (`Channel.triggerWords` + `comments_enabled`).

## ✅ Сделано (Фазы A, B и старт C)
Шаг 0 (каркас) · 1a (БД+схема) · 1b (сид «канал №1») · 2 (триггеры+кулдаун) ·
3 (меню админа: CRUD триггеров) · 4 (автопостинг) · 5 (одобрение постов) ·
6a (фото dual-provider) · 6b (кнопки на постах) · 6.5 (ручной редактор контент-плана) ·
доработка 6b (редактор пулов button_*) · 7a (напоминалка о конце контента) ·
7b (инфра MTProto+GramJS) · 7c (еженедельный отчёт + PostMetric) ·
7d (новый контент-план + 11 пулов + runbook смены бота — ФИНАЛ ФАЗЫ B) ·
8a (реестр каналов + переключатель) · 8b (мультиканальный автопостинг) ·
8c (маршрутизация триггеров в комментах по группе обсуждения) ·
9a (онбординг канала: авто-регистрация по `my_chat_member` + проверка прав бота) ·
доработка UI (настраиваемый кулдаун + удаление тестовой публикации) ·
6c (разовый пост в расписание: oneOff в `Post` + мастер «Новый пост» + публикация по `publishAt`) ·
хотфикс MTProto/устойчивости (destroy + сообщение о мёртвой сессии + bot.catch + setMyCommands) ·
аудит надёжности (protect в cron + auto-retry + прогресс по-времени + онбординг от владельца) ·
UX админ-меню (группировка 2×5 + свежие тексты + pluralRu) ·
10a (фундамент AI-генерации: `core/ai` + `aiGenerationService` + `tryGeneratePost`) ·
10b (AI-пост → очередь одобрения: миграция `PendingPost.pexelsQuery` + `ApprovalDraft`/
`requestApprovalForDraft` + `requestAiPostApproval` + кнопка «🤖 AI-пост» + фикс reroll).

Тесты сейчас: **vitest 196/196**, tsc 0, eslint 0.

## 📌 Ключевые решения
- Стек: TS strict, grammY, zod, pino, vitest, ESLint (no-any).
- **Prisma 7.8 + PostgreSQL.** Локально PG 18 (`aicm_dev`, user `postgres`/`postgres`).
  Прод — облачный Postgres, переключение через `DATABASE_URL`.
- **Prisma 7:** `url` НЕ в schema.prisma, а в `prisma.config.ts`; рантайм — адаптер
  `@prisma/adapter-pg`. Генератор → `src/generated/prisma` (в .gitignore). `.env` через
  `process.loadEnvFile()` (без dotenv).
- Хостинг: **Railway** (~$5/мес, long polling). Репо:
  https://github.com/vovabakin96416-sketch/MasterPost (публичный).
- Секреты только в `.env` (gitignore) и env хостинга — в git НЕ коммитим.
- **ADMIN_ID** в env (zod, обязателен). Локально `7035079048`.
- Цель публикации задаётся НЕ в коде, а из `/menu → Автопостинг → Указать канал`.
  Прод-канал `@sofia_gada1ka`, тест-канал `@supertestmaster`.

## ⚠️ Не трогать
- Python-бот (референс): `Soffia\04-Бот\bot\bot.py`
- Папка `taro30`

## ⏳ За пользователем (ручные проверки в Telegram)
Полный список ручных проверок по каждому шагу — в конце соответствующей записи
`docs/ARCHIVE-PROGRESS.md`. Прод-нюансы шага (миграции/env/сид) — там же помечены ⚠️.
