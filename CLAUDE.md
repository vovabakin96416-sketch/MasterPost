# CLAUDE.md — карта проекта и правила работы

Этот файл загружается автоматически в начале каждой сессии. Держать коротким.

## ⚠️ Правила работы (экономия контекста)

Контекстное окно ограничено. Не читать весь проект и не загружать файлы целиком без нужды.

**Источники истины (прочитать один раз в начале сессии):**
1. Этот файл (`CLAUDE.md`) — карта проекта и ключевые решения.
2. [`STATE.md`](STATE.md) — текущий шаг, что сделано, решения.
Не перечитывать их на каждой реплике.

**Чтение остальных файлов:**
- Открывать файл ТОЛЬКО если он нужен для текущей задачи.
- Запрашивать конкретный файл или его фрагмент (Grep/offset), а не каталог целиком.
- Никогда не сканировать весь `src/` ради «понимания контекста».
- `docs/ARCHIVE-PROGRESS.md` (история по шагам) — открывать ТОЛЬКО ради истории
  конкретного шага, не целиком. Искать нужный шаг через Grep.
- `ПЛАН.md` (роадмап) и `План.txt` (стратегия) — справочно, на запрос. Не на старте.

**Чего не делать:**
- Не пересказывать то, что уже описано в `CLAUDE.md` / `STATE.md`.
- Не дублировать содержимое файлов в ответе.

**Если данных не хватает** — не читать весь проект; назвать конкретный файл, который
нужно открыть, или уточнить у пользователя.

**В конце ответа** — если для продолжения нужен файл, указать какой именно (один-два).

## 🧭 Что за проект
Универсальный (niche-agnostic) бот-управитель Telegram-каналов на TypeScript. Порт
рабочего Python-бота на TS + рост в мультиканальный SaaS «AI-директор канала». Первый
канал для обкатки — таро `@sofia_gada1ka`. Вся тематика (слова, тексты, кнопки) — это
ДАННЫЕ в БД, а не код. Главное требование: маленькие шаги, изолированные модули.

## 🧱 Стек
TS strict (no `any`) · grammY · Prisma 7.8 + PostgreSQL · zod · croner · pino · vitest ·
GramJS (MTProto, только для аналитики) · хостинг Railway.

## 🗺 Карта `src/`
- `config/env.ts` — zod-валидация env.
- `core/` — ЧИСТАЯ логика (без Telegram/БД), покрыта тестами:
  `triggers/` (matchTrigger, pickPrediction, cooldown) · `schedule/` (localDate,
  resolveCampaignDay, times) · `menu/` (callbackData, paginate, validation, selectChannel) ·
  `approval/` · `buttons/` · `media/` · `content/` (схемы постов/пулов) · `analytics/`.
- `db/` — `client.ts` (фабрика Prisma) + `repositories/` (channel, post, textPool,
  cooldown, pendingPost, postMetric, setting).
- `services/` — оркестрация: `postingService`, `approvalService`, `mediaService`
  (+ media/pexels|gen), `analyticsService`, `postButtons`, `autopostSettings`,
  `analytics/` (mtprotoClient, weeklyReportService).
- `telegram/` — `bot.ts` (сборка композеров) + `features/`: `admin/` (меню, самый большой),
  `approval/`, `comments/` (триггеры в комментах), `postButtons/`.
- `scheduler/` — croner-джобы (автопостинг + аналитика).
- `seed/` — сид данных канала №1 (`data/content.json`, `data/texts.json`).
- `index.ts` — точка входа.
- `generated/prisma/` — авто-генерация Prisma, НЕ редактировать (в .gitignore).

## ⚙️ Команды
`npm run dev` · `npm run typecheck` · `npm run lint` · `npm run test` (vitest) ·
`npm run build` · `npm start` · `npm run seed` · `npm run gen-session` (MTProto-сессия).

## 🔁 Регламент сессии
**1 сессия = 1 шаг (или подшаг), доведённый до конца + проверки + git-коммит.**
1. Прочитать `STATE.md` → понять текущий шаг.
2. Сделать ТОЛЬКО этот шаг.
3. Проверить: `typecheck` + `lint` + `test` (+ запуск, если нужно).
4. В конце: дописать запись в `docs/ARCHIVE-PROGRESS.md`, обновить шапку `STATE.md`, коммит.

## ⚠️ Не трогать
Python-бот `Soffia\04-Бот\bot\bot.py` (референс) · папка `taro30`.
