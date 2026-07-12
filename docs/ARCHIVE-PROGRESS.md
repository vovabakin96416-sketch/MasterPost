> АРХИВ. Полная история по шагам. НЕ читать целиком — только нужный шаг (Grep/поиск). Актуальный статус — в STATE.md.

# Прогресс

✅ Сделано: Шаг 0 (каркас), Шаг 1a (БД + схема), Шаг 1b (сид «канала №1»),
   Шаг 2 (триггеры в комментах + кулдаун + тесты), Шаг 3 (меню админа: CRUD триггеров),
   Шаг 4 (автопостинг: расчёт недели + croner-тик + раздел меню),
   Шаг 5 (одобрение постов: превью админу с кнопками перед публикацией),
   Шаг 6a (фото: dual-provider mediaService + фото в публикации/превью/одобрении),
   Шаг 6b (кнопки на постах: button_choice → попап, button_prediction → личка),
   Шаг 6.5 (ручной редактор контент-плана в /menu: правка текста постов + удаление),
   Доработка 6b (редактор пулов button_* из /menu),
   Шаг 7a (аналитика, часть 1: напоминалка о конце контента — без MTProto),
   Шаг 7b (инфра MTProto+GramJS: вход под личным аккаунтом + генератор сессии),
   Шаг 7c (еженедельный отчёт по просмотрам + модель PostMetric),
   Шаг 7d (новый контент-план + 11 пулов + рунбук смены бота — ФИНАЛ ФАЗЫ B),
   Шаг 8a (реестр каналов + переключатель текущего канала в /menu — старт ФАЗЫ C),
   Шаг 8b (мультиканальный автопостинг: планировщик обходит все активные каналы),
   Шаг 8c (маршрутизация триггеров в комментах по группе обсуждения),
   Шаг 9a (онбординг канала + проверка прав), Доработка 9a+ (кулдаун-настройка + чистка UI),
   Шаг 6c (разовый пост в расписание: oneOff в Post + мастер «Новый пост» + публикация по publishAt)
🔜 Сейчас: Шаг 10a готов (фундамент AI-генерации: core/ai + сервис + tryGeneratePost).
   Дальше — Шаг 10b (черновик → очередь одобрения + кнопка «🤖 AI-пост»).
   Мультиканальная аналитика (еженедельный отчёт) ОТЛОЖЕНА.
📌 Решения:
- TS strict, grammY, zod, pino, vitest, ESLint(no-any)
- **Prisma 7.8 + PostgreSQL.** Локально — PostgreSQL 18 (БД `aicm_dev`, пользователь
  `postgres`, пароль сброшен на `postgres`). Прод — облачный Postgres (Neon/Supabase),
  переключение через `DATABASE_URL`.
- **Prisma 7 specifics:** `url` НЕ в schema.prisma, а в `prisma.config.ts`
  (`datasource.url`); рантайм-клиент — через драйвер-адаптер `@prisma/adapter-pg` (`pg`).
  Генератор `prisma-client` → `src/generated/prisma` (в .gitignore + eslint-игнор).
  `.env` грузится нативно `process.loadEnvFile()` (без dotenv).
- Хостинг: Railway (~$5/мес, выбран за простоту; long polling без правок)
- Репозиторий: https://github.com/vovabakin96416-sketch/MasterPost (публичный)
- Секреты только в .env (gitignore) и env-переменных хостинга — в git не коммитим
- **ADMIN_ID** (Telegram user id владельца) — в env (zod, обязателен). Локально 7035079048.
⚠️ Не трогать: Python-бот (референс, Soffia\04-Бот\bot\bot.py), папка taro30

## Журнал
- Шаг 0a: каркас проекта создан (package.json, tsconfig strict, eslint no-any,
  src/{config,lib,telegram,server,index}, tests/env.test.ts). Бот отвечает на /start.
- Шаг 1a: подключена БД. Установлены prisma 7.8, @prisma/client, @prisma/adapter-pg,
  pg, croner. Спроектирована `prisma/schema.prisma` под мультиканальность и любую нишу:
  модели Channel, Post, TextPool, Setting, Cooldown, Subscriber (все с `channelId`),
  enum InteractiveType/Slot/Weekday. Миграция `init` применена (6 таблиц в `aicm_dev`).
  `DATABASE_URL` добавлен в zod-env (`src/config/env.ts`) и `.env`/`.env.example`.
  Проверки зелёные: tsc 0, eslint 0, vitest 6/6; приложение поднимается (health + long
  polling), `/start` работает с реальным токеном.
  ⚠️ Для запуска бота нужно вписать `BOT_TOKEN` в `.env` (в репозитории его нет).
- Шаг 1b: сид «канала №1» (таро). Источники правды перенесены В РЕПО как данные:
  `src/seed/data/content.json` (32 поста, копия из Python-бота) и
  `src/seed/data/texts.json` (6 пулов из `DEFAULT_TEXTS`: karta/kofe/runa/
  button_love/button_money/button_cards). Архитектура слоёв:
  - `src/core/content/{postSchema,textPoolSchema}.ts` — ЧИСТЫЕ zod-схемы +
    маппинг snake_case→camelCase (`toPostSeed`, `parsePosts`, `parseTextPools`),
    покрыто тестами без БД.
  - `src/db/client.ts` — фабрика `createPrismaClient(url)` (адаптер @prisma/adapter-pg).
  - `src/db/repositories/{channel,post,textPool}Repository.ts` — идемпотентные
    upsert по уникальным ключам (канал по username, пост по channelId+externalId,
    пул по channelId+key). ⚠️ Json-поля choices/button при null → `Prisma.DbNull`.
  - `src/seed/{index,channel}.ts` — оркестратор (`npm run seed`, через tsx):
    loadEnvFile→parseEnv→читает JSON через fs→zod→upsert. Метаданные таро-канала
    (title «Таро · София», username sofia_gada1ka, triggerWords карта/кофе/руна) —
    данные, не код.
  Проверки зелёные: tsc 0, eslint 0, vitest 13/13 (6 env + 7 content).
  `npm run seed` дважды → идемпотентно: Channel=1, Post=32, TextPool=6 (без дублей).
  ⚠️ Локальный `.env` теперь содержит BOT_TOKEN (parseEnv в сиде проходит).
- Шаг 2: триггеры в комментах. Слова берём из `Channel.triggerWords` (не хардкод).
  Чистый core под тестами (vitest 25/25):
  - `src/core/triggers/matchTrigger.ts` — `normalizeTriggerText` (lower, ё→е,
    знаки→пробел, схлоп повторов «кааарта→карта») + `matchTrigger(text, words)`,
    замена per-word regex Python-бота. Совпавшее слово = ключ пула и кулдауна.
  - `src/core/triggers/pickPrediction.ts` — `renderTemplate({name})` +
    `pickPrediction(pool, name, rng=Math.random)` (инъекция rng для тестов).
  - `src/core/triggers/cooldown.ts` — `isOnCooldown`/`nextExpiry` (24ч).
  Доступ к данным:
  - `cooldownRepository.tryConsumeCooldown` — атомарный check+upsert по уникуму
    `channelId_userId_trigger`; потребляем только когда реально отвечаем.
  - `textPoolRepository.getTextPool`, `channelRepository.getActiveChannel`,
    `settingRepository.getBooleanSetting` (comments_enabled, дефолт ВКЛ; тумблер — Шаг 3).
  Telegram — изолированный конвейер `src/telegram/features/comments/`:
    `[moderationStage no-op] → [triggerStage реальный] → [aiReplyStage no-op]`
    (задел под Шаги 9/11, заглушки аддитивны). Композер слушает текст в
    group/supergroup, не команды; стадии до первой `"handled"`.
    `createBot(token, {prisma, logger})` теперь с зависимостями; index.ts создаёт
    prisma и закрывает при shutdown.
  - **Данные:** триггер-пулы в `texts.json` пере-ключены `karta/kofe/runa` →
    `карта/кофе/руна` (совпавшее слово напрямую = ключ пула). `button_*` не тронуты.
    ⚠️ В БД остались СИРОТЫ — старые пулы `karta/kofe/runa` (upsert их не удаляет).
    Безвредны (бот читает пул по слову-триггеру); чистятся ручным удалением или
    пере-сидом на свежей БД.
  Проверки зелёные: tsc 0, eslint 0, vitest 25/25, `npm run seed` идемпотентно.
  ⏳ Ручная проверка в Telegram (бот в группе обсуждений: «карта»→ответ, повтор 24ч→
    молчит) — за пользователем, нужен реальный токен и связанная группа.
- Шаг 3: меню админа (`/menu`) — управление без кода, изолированный Composer
  `adminMenu`. Объём v1: полный CRUD триггеров. Доступ только `ADMIN_ID`
  (`src/config/env.ts`, zod number; `.env`=7035079048).
  Переиспользуемый каркас меню (новый раздел = пара строк):
  - `src/core/menu/callbackData.ts` — протокол `m:<action>:<args>` (индексы, не
    кириллица — лимит 64 байта), `encode/decodeCb`, `intArg`.
  - `src/core/menu/paginate.ts` — `paginate(items,page,size)` (зажим страницы).
  - `src/core/menu/validation.ts` — `validateAnswer` + `validateTriggerWord`
    (дедуп через `normalizeTriggerText` из Шага 2).
  - `src/telegram/features/admin/{keyboard,screens,index,types}.ts` — хелпер
    клавиатур + авто-навигация Назад/Домой, рендереры экранов (главное/триггеры/
    триггер/ответ/настройки/статус + «скоро»-задел под Шаги 4/5/11), роутер
    callback'ов, режим ввода текста.
  Мутации БД (раньше было только чтение):
  - `channelRepository`: `addTrigger`/`removeTrigger` (атомарно слово+пул в
    `$transaction`), `getChannelDisplay` (для статуса).
  - `textPoolRepository`: `addText`/`updateText`/`removeText`,
    `listTriggerSummaries` (счётчик ответов на экране списка).
  - `settingRepository`: `setBooleanSetting`/`toggleBooleanSetting`.
  Ответы живут ВНУТРИ триггера (отдельного раздела «Ответы» нет). Добавить триггер =
  слово в `Channel.triggerWords` + пустой `TextPool`; удалить = убрать из обоих.
  Тумблер `comments_enabled` управляет ответами в комментах (связка с Шагом 2).
  Ввод текста — in-memory `Map<userId,PendingInput>` (порт `ConversationHandler`;
  без плагина conversations). ⚠️ Состояние теряется при рестарте — осознанный
  компромисс для единичных операций одного админа.
  Проверки зелёные: tsc 0, eslint 0, vitest 43/43 (8 env + 7 content + 12 triggers +
  16 menu).
  ⏳ Ручная проверка в Telegram (за пользователем, нужен токен+ADMIN_ID в .env):
    `/menu` от админа → меню, от другого → отказ; Триггеры→слово→ответы, добавить/
    изменить/удалить ответ; добавить «звезда» → отвечает в комментах; удалить триггер;
    тумблер ВЫКЛ → молчит.
- Шаг 3 (деплой на Railway, по ходу сессии). Раньше Railway держал активным
  только Шаг 0a — автодеплои Шагов 1/2/3 падали на сборке. Причина: `src/generated`
  в `.gitignore`, а `prisma generate` при сборке не запускался → `tsc` не находил
  модуль БД. Исправлено (коммит `22d8cb9`):
  - `package.json`: build = `prisma generate && tsc`, start = `prisma migrate deploy
    && node dist/index.js` (накат схемы в прод-БД при старте).
  - На Railway добавлен сервис **Postgres**; на бот-сервис добавлена переменная
    `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (приватная сеть `postgres.railway.internal`).
    Переменные бот-сервиса: BOT_TOKEN, ADMIN_ID, DATABASE_URL.
  - Деплой `22d8cb9` успешен (ACTIVE): миграция применена, `bot started`.
  - Прод-база засеяна через Railway Console (`npm run seed`): канал sofia_gada1ka,
    32 поста, 6 пулов. Бот живёт 24/7, ПК держать не нужно.
  ⚠️ Новый TS-бот = @masterpostingerbot (отдельный от старого Python-бота канала).
    Сид/прод-база изолированы от Python-бота (тот на своих JSON). Если @masterpostingerbot
    добавить в группу обсуждений реального канала — отвечать на триггеры будут оба;
    регулируется тумблером «Ответы в комментах».
- Усиление (анти-повтор ответов + свежесть пулов): чтобы ответы не приедались.
  A. Анти-повтор «колода» (на пользователя): человек видит ВСЕ ответы пула, прежде
     чем хоть один повторится. Память недавно показанных — в строке `Cooldown`
     (новое поле `recent String[]`, миграция `cooldown_recent`), без новой таблицы.
     - `core/triggers/pickPrediction.ts`: `answerKey` (djb2→base36, по содержимому —
       переживает правки пула) + `pickPredictionNoRepeat(pool, recentKeys, name, rng)`
       (кандидаты без недавних; сброс при исчерпании; память обрезается до N−1).
       Старый `pickPrediction` удалён как мёртвый код (остался `renderTemplate`).
     - `db/cooldownRepository`: `tryConsumeCooldown` разнесён на `loadCooldown`/
       `saveCooldown` (срок + recent). `triggerStage` перерисован: load → isOnCooldown →
       pickNoRepeat → saveCooldown(nextExpiry, recentKeys) → ответ.
  B. Индикатор свежести пула в панели (используем `TextPool.updatedAt`):
     - `core/content/poolHealth.ts`: `poolHealth(count, updatedAt, now)` → stale/reason
       (few: <4 ответов; old: >60 дней) + `poolAgeDays`.
     - `db/textPoolRepository`: `listTriggerSummaries` теперь с `updatedAt`; новый
       `getTextPoolDetail` (тексты + updatedAt).
     - `admin/screens`: ⚠️ у застоявшихся слов в списке; на экране триггера «обновлён
       N дн назад» + подсказка; в статусе строка «Освежить пулы: …» / «все ок ✅».
  C/D зафиксированы на потом: напоминание раз в месяц (Шаг 4, croner) и авто-генерация
     ответов через AI (Шаги 10–11).
  Проверки зелёные: tsc 0, eslint 0, vitest 52/52 (env 8 + content 7 + triggers 15 +
  menu 16 + poolHealth 6). Миграция `cooldown_recent` применена к локальной БД.
  ⏳ Прод: при следующем деплое `prisma migrate deploy` накатит `cooldown_recent` на
    Railway-БД автоматически (start-скрипт). Ручная проверка свежести/анти-повтора — в TG.
- Шаг 4: автопостинг (порт `get_post_for_today`/`scheduled_*_post`/`send_post`).
  Решения сессии: цель публикации — тест-канал `@supertestmaster` (НЕ живой канал, где
  Python-бот → иначе дубли); адрес в БД (`Channel.chatId`). Время слотов выбирает админ из
  меню. На Шаге 4 — только текст (фото — Шаги 5–6, кнопки — Шаг 6). Автопостинг по умолчанию ВЫКЛ.
  Чистое ядро под тестами (vitest 69/69, +17 schedule):
  - `core/schedule/localDate.ts` — `localDateParts(now, tz)` через `Intl` (день/час канала).
  - `core/schedule/resolveCampaignDay.ts` — неделя 1..4 по кругу + день (порт `(delta//7)%4+1`).
  - `core/schedule/dueSlots.ts` — `parseTime` + `dueSlots` (слот «пора» если время≥ И не постили
    сегодня): даёт редактируемость времени и догон после простоя без пересоздания джоба.
  Расписание — НЕ фиксированный cron, а **минутный тик** `* * * * *` + дедуп по локальной дате
  (отметки `last_post_morning/evening` в `Setting`). Аналог `misfire_grace_time` Python.
  Сервисы/БД:
  - `services/postingService.ts` — `buildPostMessage`, `safeSend` (Markdown→откат, порт
    `safe_send`), `publishDueSlots` (тик), `publishNow` (ручная публикация из меню).
  - `services/autopostSettings.ts` — ключи/дефолты настроек (enabled=ВЫКЛ, 10:00/20:00) +
    `readAutopostConfig`/`setSlotTime`/`markSlotPosted`/`toggleAutopost`.
  - `scheduler/index.ts` — `startScheduler` (croner `Cron`, тик раз в минуту, ошибки в лог).
  - `db`: `Channel.chatId` (миграция `channel_chatid`); `channelRepository.getPostingChannel`;
    `postRepository.getPostForToday`; `settingRepository.get/setStringSetting`.
  - `index.ts` — поднимает scheduler (`bot.api`), останавливает при shutdown.
  Меню: раздел «📅 Автопостинг» (замена заглушки `soon`): статус ВКЛ/ВЫКЛ, цель, текущая
  неделя/день, времена, «опубликовать сейчас: утро/вечер». Тумблер `atgl`, ввод времени
  (`amt`/`aet` → pending `setTime` → `validateTime`), `apub`. `core/menu/validation.validateTime`.
  Проверки зелёные: tsc 0, eslint 0, vitest 69/69; `npm run seed` идемпотентно проставил
  `chatId=@supertestmaster`; smoke-старт — scheduler+бот поднимаются (409 Conflict ожидаем:
  тот же токен уже поллит Railway-инстанс).
  ⚠️ Прод (Railway): деплой накатит `channel_chatid` (`prisma migrate deploy`); чтобы автопостинг
    реально пошёл — в прод-БД задать `Channel.chatId` (пере-сид проставит `@supertestmaster`) и
    добавить @masterpostingerbot админом в `@supertestmaster`, затем включить тумблер.
  ⏳ Ручная проверка в TG (за пользователем): `/menu`→«Автопостинг» показывает неделю/день;
    «Опубликовать сейчас: утро» → пост в `@supertestmaster`; включить + время на ближайшую
    минуту → публикуется тиком; повтор в ту же минуту/день → не дублируется.
- Решение по контенту (роадмап, занесено в ПЛАН.md): приоритет — **AI-самообновление постов**
  (Шаг 10), чтобы контент не повторялся; **ручной редактор контент-плана в меню** — добавлен как
  **Шаг 6.5** (запасной путь, по образцу триггеров Шага 3). Сейчас 4-недельный план крутится по
  кругу, новый месяц заливается через `npm run seed`.
- Доработка 4.1 (по запросу пользователя): вместо 2 слотов «утро/вечер» — **произвольный список
  времён публикации** + **кнопка подключения канала из меню** (раньше chatId ставился только
  пере-сидом → пользователь не мог сам). Миграция НЕ нужна (chatId уже есть; времена/прогресс —
  строки `Setting`).
  - Модель: посты дня `(week, day)` берутся по их полю `time` (`getPostsForDay`) и публикуются
    ПО ПОРЯДКУ в заданные времена (1-е время → 1-й пост, …). Постов меньше времён → лишние
    пропускаются. `Post.slot` в схеме остаётся, но в расписании не используется.
  - Ядро: `core/schedule/times.ts` (был `dueSlots.ts`): `parseTime` + `sortTimes` (валид/дедуп/
    сортировка) + `dueTimes(today, times, progress)` (наступившие и не отработанные сегодня;
    дедуп/сброс/догон). `core/menu/validation.validateChannelTarget` (@username / t.me / id).
  - Данные: `postRepository.getPostsForDay`; `channelRepository.setChatId`;
    `settingRepository.get/setJsonSetting` (старые `get/setStringSetting` удалены как мёртвые).
  - Сервис: `autopostSettings` переписан на ключи `autopost_enabled` / `autopost_times` (массив,
    дефолт ["10:00","20:00"]) / `autopost_progress` ({date, postedTimes}) + `addTime`/
    `removeTimeAt`/`saveProgress`/`toggleAutopost`. `postingService.publishDuePosts` (тик по
    индексу = число постнутых сегодня) + `publishNow` (первый пост дня, тест-кнопка).
  - Меню: раздел «📅 Автопостинг» — статус-тумблер, «📡 Указать канал» (ввод @username/ссылки/id),
    список времён (строка `🕐 HH:MM ✖` удаляет), «➕ Добавить время», «📤 Опубликовать сейчас (тест)».
    `PendingInput`: `setTime` → `addTime`/`setChannel`.
  - Проверки зелёные: tsc 0, eslint 0, vitest 74/74 (schedule 22); smoke-старт ок.
  ⏳ Прод (Railway): миграций нет, деплой только обновит код. Чтобы пошло: `/menu → Автопостинг →
    📡 Указать канал` → прислать `@supertestmaster`; добавить бота админом канала; включить тумблер.
- Шаг 5: одобрение постов (порт `approval_keyboard`/`approval_callback`/`request_approval`/
  `receive_edit`). Изолированный композер `approval` + сервис. Гейт перед публикацией: если
  одобрение ВКЛ — пост уходит не в канал, а админу на превью с кнопками; в канал попадает
  только после «✅ Опубликовать».
  Объём кнопок: **✅ Опубликовать / ✍️ Изменить текст / ⏭ Не сегодня / ❌ Отменить**.
  Фото-кнопки Python-бота («🔄 Другое фото / 🖼 Своё фото») ОТЛОЖЕНЫ на Шаг 6 — медиа в
  TS-порте пока нет (`PostToPublish` без фото, `mediaService` = Шаг 6). Добавятся в ту же
  клавиатуру, когда появится подбор фото.
  Хранение очереди — в БД (НЕ in-memory `pending_posts`, как Python): новая модель
  **`PendingPost`** (снимок title/text/cta + externalId), миграция `pending_post`. Снимок =
  правки на одобрении меняют копию, контент-план не трогается. Переживает редеплой Railway.
  Слои:
  - `core/approval/callback.ts` — ЧИСТЫЙ протокол кнопок превью `ap:<action>:<id>` (отдельный
    префикс `ap`, не `m` меню), `encode/decodeApproval`. id = cuid строки PendingPost (влезает в 64б).
  - `core/approval/caption.ts` — `buildApprovalCaption(snapshot, target)` (порт `_approval_caption`),
    `PostSnapshot`. Обе — под тестами (tests/approval.test.ts, 6 шт.).
  - `services/approvalService.ts` — ключ `approval_enabled` (дефолт **ВКЛ**, как в Python),
    `isApprovalEnabled`/`toggleApproval`, `approvalKeyboard` (4 кнопки).
  - `db/pendingPostRepository.ts` — `create/get/updateText/delete/countPending`.
  - `services/postingService.ts` — гейт в `publishDuePosts` (approvalOn → `requestApproval`
    вместо `safeSend`); `requestApproval` (снимок в БД + превью админу с откатом Markdown),
    `publishPending` (одобренный → канал + удалить из очереди), `requestApprovalForToday`
    (тест-превью первого поста). `buildPostMessage` принимает `PostSnapshot`; `PostToPublish`
    и `getPostsForDay` теперь несут `externalId`.
  - `telegram/features/approval/index.ts` — композер: кнопки `ap:*` (pub/edit/skip/cancel) +
    правка текста (in-memory Map adminId→pendingId, как меню). После обработки превью
    `editMessageText` без клавиатуры (кнопки исчезают).
  ⚠️ Изоляция композеров: меню теперь отдаёт ЧУЖИЕ callback/текст дальше через `next()` (раньше
    глушило) — иначе `ap:*` не доходили до композера одобрения. Порядок: admin → approval → comments.
  Меню: пункт «📋 Одобрение постов» (замена заглушки `soon`) → `renderApproval`: статус-тумблер
    `aptgl`, «ждут одобрения: N», «👀 Прислать превью (тест)» `appv`.
  Проверки зелёные: tsc 0, eslint 0, vitest **80/80** (+6 approval); прод-сборка
    (`prisma generate && tsc`) ок. Миграция `pending_post` применена к локальной БД.
  Локальный запуск НЕ делали — тот же токен поллит Railway (два поллера конфликтуют).
  ⚠️ Прод (Railway): деплой накатит `pending_post` (`prisma migrate deploy`). Дефолт одобрения
    ВКЛ → как только автопостинг включён, посты пойдут админу на превью, а НЕ в канал, пока не
    нажать «✅ Опубликовать». Чтобы публиковать без подтверждения — `/menu → 📋 Одобрение → выключить`.
  ⏳ Ручная проверка в TG (за пользователем): `/menu → 📋 Одобрение → 👀 Прислать превью` → приходит
    превью с 4 кнопками; «✍️ Изменить текст» → прислать текст → новое превью; «✅ Опубликовать» →
    пост в `@supertestmaster`, кнопки исчезают; «❌ Отменить»/«⏭ Не сегодня» → пост не уходит.
- Шаг 6a: ФОТО к постам — две версии продукта в одной абстракции (порт `_resolve_photo`/
  `fetch_pexels_photo`/`receive_photo`/ветки `aphoto`). Решения сессии (через вопросы):
  бесплатная версия = **Pexels** (как в Python); платная = **AI-генерация, заложена архитектурой,
  движок на Шаге 10** (у Anthropic генерации картинок нет); Шаг 6 разбит на 6a (фото) /
  6b (кнопки) / 6c (календарные посты). «Праздники» переосмыслены как нишенезависимая фича
  (захардкоженные эзо-праздники против принципа «нет тематики в коде») — отложены в 6c.
  Чистое ядро под тестами (vitest 92/92, +12 media):
  - `core/media/types.ts` — `PhotoRef` (url|fileId|path), `MediaTier` (free|paid). Без grammY.
  - `core/media/resolvePriority.ts` — `planPhoto` (приоритет: photoUrl → photoPath → pexelsQuery →
    none), порт `_resolve_photo`, без сети/I/O.
  Провайдеры (абстракция = две версии):
  - `services/media/provider.ts` — интерфейс `MediaProvider { name; fetch(query, ctx) }`.
  - `services/media/pexelsProvider.ts` — **бесплатный**, порт `fetch_pexels_photo` (портрет,
    per_page 15, random → src.large; нет ключа/ошибка/пусто → null, мягкая деградация на текст).
  - `services/media/genProvider.ts` — **платный, ЗАГЛУШКА** (всегда null → откат на сток; движок — Шаг 10).
  - `services/mediaService.ts` — `getMediaTier` (настройка `media_tier`, дефолт free),
    `providerFor`, `fetchPhotoUrl` (платный при неудаче → откат на Pexels), `resolvePhoto`
    (план + провайдер → `PhotoRef|null`), `refToCacheString` (url/file_id кэшируем, путь — нет).
  Интеграция:
  - Env: `PEXELS_API_KEY` (zod **optional**) + `.env.example`. Без ключа — посты без фото.
  - БД: `PendingPost.photoUrl String?` (миграция `pending_post_photo`) — кэш выбранного фото
    (URL Pexels или TG `file_id`), чтобы превью и публикация брали одну картинку.
    `pendingPostRepository`: `photoUrl` в row/select/input + `setPendingPhoto`.
    `postRepository`: `PostToPublish` + `getPostsForDay` несут `pexelsQuery`/`photoPath`;
    новый `getPostPhotoSources` (для «🔄 Другое фото»).
  - `postingService`: `safeSend` → `sendPost(deps, chatId, text, photo, keyboard?)`
    (sendPhoto+подпись с откатом без parse_mode; битый URL → публикуем текстом; обрезка подписи
    до 1024). `PostingDeps` + `pexelsApiKey`. `publishNow`/прямая ветка `publishDuePosts` →
    `resolvePhoto` перед отправкой. `requestApproval` пред-загружает фото и кэширует в `PendingPost`.
    `publishPending` шлёт с `pending.photoUrl`. Новые `sendApprovalPreview`/`photoRefFromCache`.
  - `approvalService.approvalKeyboard` → **6 кнопок** (паритет Python): + «🔄 Другое фото» (`ap:reroll`),
    «🖼 Своё фото» (`ap:own`). `core/approval/callback` — экшены `reroll`/`own`.
  - `approval` композер: `reroll` (перевыбор у Pexels по `getPostPhotoSources` → `setPendingPhoto` →
    новое превью), `own` (in-memory режим ожидания фото → `message:photo` → `file_id` →
    `setPendingPhoto` → новое превью). `editResolved` теперь и `editMessageCaption` (превью бывает
    с фото). Правка текста сохраняет фото.
  - Проброс `pexelsApiKey`: env → `index.ts` → `BotDeps`/`AdminDeps`/`ApprovalDeps`/`PostingDeps`.
  Проверки зелёные: tsc 0, eslint 0, vitest 92/92; миграция `pending_post_photo` применена локально;
  `prisma generate` ок. Локальный запуск НЕ делали (тот же токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой накатит `pending_post_photo` (`prisma migrate deploy`). Чтобы фото
    появилось — задать `PEXELS_API_KEY` в переменных Railway (без него посты идут текстом).
  ⏳ Ручная проверка в TG (за пользователем, нужен `PEXELS_API_KEY`): `/menu → 📋 Одобрение →
    👀 Прислать превью` → превью **с фото**; «🔄 Другое фото» → картинка меняется; «🖼 Своё фото» →
    прислать фото → превью с ним; «✅ Опубликовать» → пост с фото в `@supertestmaster`. Без ключа
    Pexels → корректно публикует текст.
- Шаг 6b: КНОПКИ на постах (порт `send_post` keyboard-ветки + `choice_callback`/`prediction_callback`).
  Объём (решение пользователя): только кнопки + обработка кликов; редактор пулов button_* из /menu
  отложен на отдельный шаг. Данные уже в БД (`Post.choices`/`Post.button`, пулы button_love/money/cards
  засеяны на 1b) → миграций/сида НЕ нужно. Превью одобрения не трогаем: там слот занят кнопками
  одобрения (паритет Python — у сообщения одна клавиатура).
  Поведение (паритет):
  - `button_choice` → по строке-кнопке на вариант; нажатие показывает заготовленный `answer` ПОПАПОМ
    (show_alert, обрезка 200 симв.); без лички, без кулдауна, можно жать повторно. Ответ берём из
    исходного `Post.choices` по индексу (стабилен: правки текста на одобрении его не трогают).
  - `button_prediction` → одна кнопка; нажатие шлёт случайное предсказание из пула `btnType` В ЛИЧКУ +
    кулдаун. **Переиспуем машинерию Шага 2**: `pickPredictionNoRepeat` (анти-повтор «колода») +
    таблица `Cooldown` (`loadCooldown`/`saveCooldown`, `isOnCooldown`/`nextExpiry`, 24ч). Ключ кулдауна
    `trigger` = тип кнопки (`button_cards`…) — не пересекается со словами-триггерами. Кулдаун ставим
    ТОЛЬКО после удачной доставки (как Python). Бот не запущен у юзера (`GrammyError`) → подсказка /start.
  Слои:
  - `core/buttons/callback.ts` — ЧИСТЫЙ протокол `bp:*` (отдельный префикс, не `m`/`ap`):
    `bp:ch:<channelId>:<externalId>:<idx>` / `bp:pr:<channelId>:<btnType>`, `encodeChoiceCb`/
    `encodePredictionCb`/`decodePostButton` (размеченный union | null). channelId-cuid → обе формы ≤64б.
  - `services/postButtons.ts` — `buildPostKeyboard` (тут `InlineKeyboard`, как `approvalKeyboard`):
    choice → N строк, prediction → 1 кнопка, keyword/vote/нет данных → undefined.
  - `core/content/postSchema.ts` — `choiceSchema`/`buttonSchema` + типы `Choice`/`Button` сделаны
    публичными (переиспуем для разбора Json из Prisma).
  - `db/postRepository.ts` — `PostToPublish` + `getPostsForDay` несут `interactiveType`/`choices`/
    `button` (защитный `safeParse` Json → null при битом); новый `getPostInteractive` (для публикации
    одобренного поста: у `PendingPost` интерактива нет, берём из `Post` по channelId+externalId).
  - `services/postingService.ts` — клавиатура прикручена к 3 точкам: прямая ветка `publishDuePosts`,
    `publishNow`, `publishPending` (последний тянет интерактив через `getPostInteractive`; externalId
    null → без кнопок). Хелпер `postKeyboard(channelId, post)`.
  - `telegram/features/postButtons/index.ts` — изолированный композер (БЕЗ фильтра по adminId — жмут
    любые подписчики); `bp:*` декодит, чужое → `next()`. Зарегистрирован в `bot.ts` после approval.
  Проверки зелёные: tsc 0, eslint 0, vitest **99/99** (+7 postButtons). Миграций нет.
  Локальный запуск НЕ делали (тот же токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций/сида нет). Кнопки появятся на постах
    button_choice/button_prediction автоматически.
  ⏳ Ручная проверка в TG (за пользователем, на `@supertestmaster`): опубликовать/одобрить пост
    button_choice (id 2/3) → под постом кнопки вариантов → нажатие даёт попап с ответом; пост
    button_prediction (id 5) → «🔮 Карты отвечают» → ответ в личку, повтор в тот же день → «Уже
    отправила…»; без `/start` у бота → подсказка про /start.
- Шаг 6.5: РУЧНОЙ РЕДАКТОР контент-плана в /menu (по образцу триггеров Шага 3). Объём v1
  (решение пользователя): правка ТЕКСТА постов (title/text/cta) + удаление поста. НЕ входит:
  добавление постов, правка структуры (время/день/тип/choices/button/фото) — отдельным шагом.
  Архитектура: РАСШИРЕНИЕ существующего композера админа (`telegram/features/admin/*`), не новый
  модуль — тот же префикс `m:`, доступ `adminId`, текстовый ввод через `PendingInput`.
  Миграций/сида/нового композера НЕТ. Правим РЕАЛЬНЫЕ строки `Post` (не снимок `PendingPost`
  Шага 5) → изменения влияют на все будущие циклы публикации.
  Слои:
  - `db/postRepository.ts` — новые функции доступа/мутации: `getPlanOverview` (недели+счётчики),
    `getPostsForWeek` (orderBy day→time; Postgres-enum Weekday определён monday…sunday → порядок
    дней верный), `getPostDetail`, `updatePostField` (updateMany по channelId+externalId,
    boolean), `deletePost`. Типы `PlanWeek`/`PlanPostRow`/`PlanPostDetail`/`EditablePostField`.
  - `core/menu/validation.ts` — `validatePostField(input, field)` (ЧИСТАЯ, под тестами) +
    `POST_FIELD_LIMITS` (title 200 / cta 300 / text = MAX_ANSWER_LENGTH 3500).
  - `telegram/features/admin/types.ts` — `PendingInput` + `{kind:"editPostField", field, externalId}`.
  - `telegram/features/admin/screens.ts` — раздел «🗂 Контент-план» в `MAIN_SECTIONS`; рендереры
    `renderPlan`/`renderPlanWeek`(пагинация)/`renderPlanPost`/`renderEditPostFieldPrompt`/
    `renderDeletePostConfirm` + `postFieldByCode` (0/1/2→title/text/cta). Хелперы `pluralPosts`,
    `clip` (текст в экране поста режем до 2500, чтобы не превысить лимит сообщения 4096; полный
    текст — в приглашении правки). `DAY_SHORT_RU`/`INTERACTIVE_RU` для подписей.
  - `telegram/features/admin/index.ts` — ветки роутера `plan`/`pw`/`pp`/`ped`/`pdc`/`pdel` +
    `handleInput` case `editPostField`. Callback компактна (`m:ped:1:5` — числовые id, ≤64б).
  ⚠️ Re-seed восстанавливает: сид идемпотентен (upsert по channelId+externalId) → удалённый из
    меню пост вернётся при `npm run seed`, правки текста перезатрутся. Ожидаемо (модель «новый
    месяц = новый сид»); отражено в подсказке подтверждения удаления.
  Проверки зелёные: tsc 0, eslint 0, vitest **104/104** (+5 validatePostField), build ок.
  Миграций нет. Локальный запуск НЕ делали (тот же токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций/сида нет). Раздел появится автоматически.
  ⏳ Ручная проверка в TG (за пользователем): `/menu → 🗂 Контент-план` → неделя → пост →
    «✏️ Текст» → прислать текст → пост обновился; «🗑 Удалить пост» → подтверждение → исчез из
    списка недели; опубликовать этот (week,day) через «Автопостинг → Опубликовать сейчас» → новый текст.
- Доработка 6b: РЕДАКТОР ПУЛОВ button_* в /menu (отложено с Шага 6b). Раздел «🔮 Кнопки-предсказания»
  по образцу триггеров Шага 3, но для пулов кнопок button_prediction. Объём: список пулов → ответы
  пула → добавить/изменить/удалить ответ. БЕЗ добавления/удаления самого пула (набор задан данными:
  ключ пула = `Post.button.type`). Архитектура: РАСШИРЕНИЕ композера админа (`m:`, `PendingInput`,
  `adminId`), не новый модуль. Миграций/сида/композера НЕТ. Правит РЕАЛЬНЫЕ `TextPool` → ответы кнопок
  меняются сразу (`handlePrediction` читает `getTextPool(channelId, btnType)`).
  Отбор пулов: ключ с префиксом `button_` (надёжно отделяет от слов-триггеров и сирот karta/kofe/runa
  Шага 2). Показываем ВСЕ 3 (love/money/cards) с маркером статуса: подключён к кнопке поста или
  «про запас» (нет поста с таким `button.type`).
  Слои:
  - `db/textPoolRepository.ts` — `listButtonPools` (where key startsWith "button_", orderBy key asc →
    индекс пула стабилен для callback) + тип `PoolSummary`. Мутации НЕ добавляли — `addText`/
    `updateText`/`removeText`/`getTextPoolDetail` уже обобщены по `key`, переиспользованы как есть.
  - `db/postRepository.ts` — `getButtonPoolMeta` → `Map<type,{label}>` из button_prediction-постов
    (парс `button` через существующий `parseButton`): наличие ключа = «подключён» + подпись для меню.
  - `telegram/features/admin/types.ts` — `PendingInput` + `addButtonAnswer{poolKey}`/
    `editButtonAnswer{poolKey,index}`.
  - `telegram/features/admin/screens.ts` — раздел в `MAIN_SECTIONS`; рендереры `renderButtonPools`/
    `renderButtonPool`/`renderButtonAnswer`/`renderAddButtonAnswerPrompt`/`renderEditButtonAnswerPrompt`
    + хелперы `buttonPoolKeyAt`/`renderButtonPoolByKey`. Переиспуют `poolHealth`/`paginate`/
    `pluralAnswers`/`preview`.
  - `telegram/features/admin/index.ts` — ветки роутера `bpl`/`bpo`/`bia`/`baa`/`bea`/`bda` +
    `handleInput` cases (validateAnswer → addText/updateText). Хелпер `buttonPoolName` (label из meta).
    `answerAt` переиспользован для текста ответа по ключу пула. Callback компактна (`m:bea:1:3`, ≤64б).
  ⚠️ button_love/button_money сейчас «про запас» (ни один пост не ссылается) — правка безопасна,
    эффекта на постах нет, пока пул не привязан к кнопке. Маркер в списке это поясняет.
  Проверки зелёные: tsc 0, eslint 0, vitest **104/104** (+4 проверки длины callback), build ок.
  Миграций/сида нет. Локальный запуск НЕ делали (тот же токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код. Раздел появится автоматически.
  ⏳ Ручная проверка в TG (за пользователем): `/menu → 🔮 Кнопки-предсказания` → виден button_cards
    («🔮 Карты отвечают», подключён) + love/money («про запас») → открыть пул → ➕/✏️/🗑 ответ;
    нажать «🔮 Карты отвечают» под постом button_prediction (id 5) → новый/изменённый ответ в личке.
- Шаг 7a: АНАЛИТИКА, часть 1 — напоминалка о конце контента (порт `analytics.py:check_content_ending`).
  Шаг 7 крупный, разбит (решение пользователя) на 7a (напоминалка, лёгкая) / 7b (инфра MTProto+GramJS,
  генератор сессии, вход с телефона) / 7c (еженедельный отчёт по просмотрам + модель `PostMetric`).
  ⚠️ Ключевое: токен бота НЕ умеет читать просмотры постов канала — только MTProto (личный аккаунт);
  поэтому отчёт (7c) требует GramJS + SESSION. 7a этого НЕ требует — чистая арифметика дат.
  Слои (паттерн проекта):
  - `core/analytics/contentEnding.ts` — ЧИСТАЯ `shouldWarnContentEnding(week)` → `week === 4`
    (`LAST_CAMPAIGN_WEEK`), под тестами. Расчёт недели НЕ дублируем — переиспуем
    `localDateParts`+`resolveCampaignDay` (Шаг 4).
  - `services/analyticsService.ts` — `AnalyticsDeps {prisma,logger,api,adminId}`; `campaignWeekOf(channel)`
    (та же связка localDate+resolveCampaignDay, что в postingService); `runContentEndingCheck` (джоб: при
    неделе 4 шлёт владельцу напоминание с откатом Markdown) + `sendContentEndingNotice` (принудительно, для
    тест-кнопки). Без env/MTProto.
  - `scheduler/analytics.ts` — `startAnalyticsScheduler`: отдельный croner-джоб `0 21 * * 0` tz Europe/Moscow
    (ВС 21:00 МСК, как Python). Готов принять джоб отчёта ПН 09:30 в 7c. Поднят в `index.ts` рядом с автопостинг-
    планировщиком, останавливается в shutdown.
  - Меню: раздел «📊 Аналитика» в `MAIN_SECTIONS` (`encodeCb("an")`) + `renderAnalytics` (текущая неделя N/4 +
    статус напоминания) + кнопка «📨 Прислать напоминание сейчас (тест)» (`anwarn` → `sendContentEndingNotice`).
    Ветки роутера `an`/`anwarn` в `admin/index.ts`. Доступ `adminId`, как у прочих разделов.
  Проверки зелёные: tsc 0, eslint 0, vitest **108/108** (+4 contentEnding), build ок.
  БЕЗ новых npm-зависимостей, env, моделей Prisma и миграций. Локальный запуск НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций/ключей нет) — раздел и джоб появятся сами.
  ⏳ Ручная проверка в TG (за пользователем): `/menu → 📊 Аналитика` → видна текущая неделя; «📨 Прислать
    напоминание сейчас (тест)» → в личку приходит текст напоминания. Автоджоб — ВС 21:00 МСК при неделе 4.
- Шаг 7b: ИНФРАСТРУКТУРА MTProto/GramJS — вход под ЛИЧНЫМ аккаунтом (порт `generate_session.py`/
  идеи `analytics.py`). Цель: научить проект логиниться в Telegram, чтобы в 7c читать просмотры постов
  (токен бота этого НЕ умеет). Сам отчёт и модель `PostMetric` — это 7c, НЕ трогали.
  Установлено: `telegram` (GramJS) 2.26.22 → `npm i telegram` (44 пакета; есть npm-audit warning'и
  у транзитивных зависимостей — не блокируют). env: `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/
  `TELEGRAM_SESSION` — все ОПЦИОНАЛЬНЫЕ (zod, по образцу `PEXELS_API_KEY`: нет ключей → отчёт
  выключен, бот работает как раньше). `.env.example` обновлён с предупреждением «SESSION = полный
  доступ к аккаунту, не коммитить».
  ⚠️ КЛЮЧЕВОЙ ПРИНЦИП ИЗОЛЯЦИИ: GramJS — тяжёлая зависимость, и она НЕ должна попадать в
  импорт-граф запущенного бота. Меню показывает лишь *статус* (настроены ли 3 env). Поэтому два модуля:
  - `core`/чистый `services/analytics/mtprotoConfig.ts` — БЕЗ GramJS: тип `MtprotoConfig`
    (поля `?: T | undefined` — иначе `exactOptionalPropertyTypes` не даёт присвоить undefined) +
    `FullMtprotoConfig` (узкий тип для 7c) + `isMtprotoConfigured(cfg)` (type-guard, все 3 заданы и
    непустые). Это импортирует меню. Под тестами.
  - `services/analytics/mtprotoClient.ts` — ЕДИНСТВЕННЫЙ модуль с `import` GramJS. Импортируется
    ТОЛЬКО скриптом генерации сессии (и позже джобом отчёта 7c) — НЕ ботом. Проверено grep'ом:
    единственный `from ".../mtprotoClient.js"` — в `scripts/generateSession.ts` (в src только упоминания
    в комментах). Функции: `createMtprotoClient(apiId,apiHash,session)` (фабрика по StringSession),
    `fetchSelfLabel(client)` (connect+getMe → `@username`/имя/id — smoke, переиспуется в 7c),
    `loginInteractive(apiId,apiHash,prompts)` (пустая StringSession → `client.start({phoneNumber/
    phoneCode/password/onError})` → `stringSession.save()`; держим свой StringSession, т.к.
    `client.session.save()` типизирован `void` у абстрактной базы, а `StringSession.save()` даёт строку).
  - `scripts/generateSession.ts` + `npm run gen-session` (tsx, как seed) — тонкая readline-обёртка:
    спрашивает api_id/api_hash (берёт из .env, если заданы) → телефон → код → 2FA → печатает
    SESSION-строку для Railway + smoke «✅ вошли как @…» (round-trip: новый клиент из полученной
    строки реально логинит). GramJS-логика — в типобезопасном src, скрипт тонкий.
  - Меню «📊 Аналитика»: `renderAnalytics` дополнен строкой «MTProto: настроен ✅» / «не настроен ⚠️»
    (+ подсказка про `npm run gen-session`). Проброс `MtprotoConfig` из env: `index.ts` → `BotDeps`
    (`bot.ts`) → `AdminDeps` (`admin/types.ts`), ровно как `pexelsApiKey`. Отчёт/кнопки 7c НЕ добавляли.
  GramJS-импорты под NodeNext (проверено эмпирически node+tsx): `import { TelegramClient } from
  "telegram"` (named ОК) и `import { StringSession } from "telegram/sessions/index.js"` (нужен ЯВНЫЙ
  путь — bare `telegram/sessions` падает с ERR_UNSUPPORTED_DIR_IMPORT). `skipLibCheck:true` снимает
  претензии к .d.ts GramJS; наш код no-any.
  ⚠️ `scripts/` вне tsconfig `include` (src/**) → НЕ проверяется `tsc`, но линтуется `eslint .` и гоняется
  `tsx`. Поэтому вся GramJS-логика в типобезопасном `mtprotoClient.ts` (src/), а скрипт тонкий.
  Проверки зелёные: tsc 0, eslint 0 (вкл. scripts/), vitest **112/112** (+4 isMtprotoConfigured),
  build (`prisma generate && tsc`) ок. tsx грузит GramJS-цепочку и строит TelegramClient (probe).
  БЕЗ моделей Prisma и миграций. Локальный запуск бота НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций/ключей нет). Чтобы отчёт 7c заработал —
    задать в Railway `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` (строку из gen-session).
    Без них меню покажет «MTProto: не настроен ⚠️», бот работает как раньше.
  ⏳ Ручная проверка (за пользователем, ЛОКАЛЬНО): `npm run gen-session` → api_id/api_hash (my.telegram.org)
    → телефон → код → 2FA → печатает SESSION + «✅ вошли как @…». Строку вставить в Railway (НЕ в git) →
    `/menu → 📊 Аналитика` покажет «MTProto: настроен ✅». Генератор логинит ЛИЧНЫЙ аккаунт (не бота) →
    409 не возникает (в отличие от `npm run dev`).
- Шаг 7c: ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ ПО ПРОСМОТРАМ + модель `PostMetric` (порт `weekly_stats_report`
  из `analytics.py`). Токен бота просмотры постов не видит → читаем через ЛИЧНЫЙ аккаунт (MTProto,
  инфра 7b). **Решение пользователя:** отчёт читает метрики из канала `Channel.chatId` (цель
  автопостинга; сейчас `@supertestmaster`) — один источник, бот анализирует канал, которым управляет.
  ⚠️ КЛЮЧЕВАЯ ИЗОЛЯЦИЯ (принцип 7b сохранён): GramJS НЕ в СТАТИЧЕСКОМ импорт-графе бота. Джоб отчёта
  грузит `mtprotoClient.ts` через **динамический `await import()`** — только в момент запуска и только
  если MTProto настроен. Grep подтверждает: единственная не-комментарная ссылка на `mtprotoClient.js`
  в `src/` — `await import(...)` в `weeklyReportService.ts`; статический `import` — лишь в скрипте gen-session.
  Слои:
  - БД: модель `PostMetric` (channelId+messageId уникум, views/reactions/replies/preview/postedAt/
    collectedAt) + back-relation в `Channel`; миграция `post_metric`. Идемпотентность: upsert по
    `[channelId, messageId]` (повторный прогон обновляет, не плодит дубли).
  - `db/repositories/postMetricRepository.ts` — `upsertPostMetric` (тип `PostMetricInput` берём из core,
    не дублируем). Чтение истории/трендов — задача Шага 12 (YAGNI).
  - `core/analytics/weeklyReport.ts` (ЧИСТЫЙ, под тестами): плоский `PostMetricInput` +
    `summariseWeekly` (суммы/среднее floor/лучший пост) + `buildWeeklyReport(metrics, tz)` (порт текста:
    строки `📅 дд.мм ЧЧ:ММ`/`👁·❤️·💬`, итоги, 🏆 лучший; пустой список → заглушка; дата через
    `Intl.DateTimeFormat` в поясе канала; чистка превью от `\n`/`*`; сортировка хронологически).
  - `services/analytics/mtprotoClient.ts` (ЕДИНСТВЕННЫЙ с `import` GramJS) — добавлен
    `fetchRecentPostMetrics(client, target, since)`: порт `iter_messages` (limit 30, стоп по дате,
    пропуск служебных без текста/медиа; `views??0`, `reactions.results.reduce(count)`, `replies.replies??0`,
    превью 80). Возвращает плоский `PostMetricInput[]` — GramJS-типы наружу не текут.
  - `services/analytics/weeklyReportService.ts` (НЕ статически импортит mtprotoClient): `WeeklyReportDeps`
    (= AnalyticsDeps + `mtproto`); `runWeeklyReport` (джоб: не настроено/нет chatId → тихо; иначе
    динам-импорт → connect → fetch → upsert → buildReport → sendToAdmin → disconnect в finally; ошибки в лог);
    `sendWeeklyReportNow` (тест-кнопка: при «не настроено/нет канала/ошибка» шлёт владельцу ПОЯСНЕНИЕ,
    не молчит). `sendToAdmin` (откат Markdown) экспортирован из `analyticsService.ts` и переиспользован.
  - `scheduler/analytics.ts` — добавлен ВТОРОЙ джоб `Cron("30 9 * * 1", tz Europe/Moscow)` →
    `runWeeklyReport`; `Scheduler.stop()` гасит оба; принимает `WeeklyReportDeps`. `index.ts` пробрасывает
    `mtproto` (env `TELEGRAM_*`) в `startAnalyticsScheduler`.
  - Меню «📊 Аналитика»: статус MTProto обновлён («отчёт приходит ПН 09:30 МСК»); при настроенном MTProto
    — кнопка «📊 Прислать отчёт по просмотрам (тест)» (`anrep`). Роутер `admin/index.ts`: `case "anrep"`
    (сразу `answerCallbackQuery "Собираю отчёт… ⏳"` — MTProto-connect долгий → не упереться в 10с лимит,
    затем `sendWeeklyReportNow` с `deps.mtproto`).
  Проверки зелёные: tsc 0, eslint 0, vitest **119/119** (+7 weeklyReport), build (`prisma generate && tsc`) ок.
  Миграция `post_metric` применена локально; `npm run seed` идемпотентен. Локальный запуск бота НЕ делали
  (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой накатит `post_metric` (`prisma migrate deploy` на старте). Чтобы отчёт пошёл —
    задать `TELEGRAM_API_ID/HASH/SESSION` (строка из `npm run gen-session`); личный аккаунт должен быть
    участником `@supertestmaster`. Без env — отчёт молчит (джоб) / поясняет (кнопка), бот как раньше.
  ⏳ Ручная проверка в TG (за пользователем, после настройки SESSION): `/menu → 📊 Аналитика` → «MTProto
    настроен ✅» + кнопка «📊 Прислать отчёт (тест)» → приходит отчёт по просмотрам `@supertestmaster` за
    неделю; запись в `PostMetric`. Автоджоб — ПН 09:30 МСК.
- Шаг 7d (ФИНАЛ ФАЗЫ B): НОВЫЙ КОНТЕНТ-ПЛАН + РАСШИРЕНИЕ ПРЕДСКАЗАНИЙ/ТРИГГЕРОВ + RUNBOOK СМЕНЫ БОТА.
  Перед выводом Python-бота из эксплуатации синхронизировали данные с актуальным Python-репо
  (`github.com/vovabakin96416-sketch/sofiacom-bot`) и довели контент до целевого объёма.
  - **Контент-план** (`src/seed/data/content.json`): заменён на новый месяц **Императрица → Колесо
    Фортуны → Сила → Мир** (был Жрица → Солнце → Луна → Звезда). Структура та же (32 поста, id 1–32,
    snake_case), перенос = замена файла. Источник — `content.json` из репо (формат 1:1 с TS).
  - **Предсказания** (`src/seed/data/texts.json`): пересобран. Было 6 пулов (5–7 текстов), стало
    **11 пулов по 20 текстов** = 220. Триггерные пулы (ключ = слово, кириллица): `карта, кофе, руна,
    знак, любовь, деньги, свет, оракул`; кнопочные: `button_love, button_money, button_cards`.
    Ключи Python (транслит `karta/znak/...`) переименованы в кириллицу, т.к. в TS ключ пула = слово
    из `Channel.triggerWords` (см. `matchTrigger`). Тексты из репо + дописаны до 20 в голосе канала.
  - **Триггеры** (`src/seed/channel.ts`): `triggerWords` расширен с 3 до **9 слов**:
    `карта, кофе, руна, знак, любовь, деньги, свет, да, нет`.
  - **Оракул да/нет** (`src/telegram/features/comments/triggerStage.ts`): слова `да`/`нет` через
    таблицу `TRIGGER_ALIASES` мапятся на ОДИН пул `оракул` (и общий кулдаун) — порт поведения
    `oracle` из Python (один пул ДА/НЕТ/ПОДОЖДИ на оба слова). `triggerKey = alias ?? matched`
    используется для пула, `loadCooldown` и `saveCooldown`.
  - Тест `tests/content.test.ts`: ожидаемые ключи 6→11 + новый инвариант «в каждом пуле ровно 20».
  Проверки зелёные: `typecheck` 0, `lint` 0, `vitest` **125/125**; `npm run seed` локально →
  `posts:32, pools:11`. Сид идемпотентен (upsert по externalId/key) и НЕ удаляет лишнее — старые
  пулы карта/кофе/руна обновлены на месте, новые добавлены.
  ⚠️ ПРОД (Railway): `start` НЕ сидит автоматически (`migrate deploy && node dist`). Чтобы новый
    контент попал в прод — после деплоя выполнить разово `npm run seed` с прод `DATABASE_URL`
    (Railway one-off command). Иначе в проде останется старый месяц.
  ⏳ RUNBOOK СМЕНЫ БОТА (за пользователем; код НЕ меняется, только env + действия в Telegram):
    Решение пользователя: НЕ переподвязываем личный MTProto-аккаунт (`TELEGRAM_*` остаются как есть);
    тестовый канал `@supertestmaster` сохраняем для прогонов.
    1) @BotFather → взять токен НОВОГО бота (боевой). 2) В канале `@sofia_gada1ka`: Управление →
       Администраторы → добавить нового бота (право публикации сообщений), СТАРОГО Python-бота убрать
       из админов. 3) Railway: `BOT_TOKEN` = токен нового бота; редеплой/рестарт. 4) Цель публикации:
       НЕ через код — в боте `/menu → 📅 Автопостинг → 📡 Указать канал` (callback `achan`,
       `setChatId`): для прода `@sofia_gada1ka`, для тестов вернуть `@supertestmaster`. (`channel.chatId`
       в сиде остаётся `@supertestmaster` как дефолт.) 5) Остановить Python-процесс — посты только из TS.
  ⏳ Ручная проверка в TG (за пользователем): после сида и смены канала написать каждое слово
    (`карта, кофе, руна, знак, любовь, деньги, свет, да, нет`) в комментариях → ответ из нужного пула;
    `да`/`нет` тянут из одного «оракула»; пост Пт (`button_cards`) и Вт/Ср (`button_choice`) работают;
    повтор слова в кулдаун не дублирует ответ.
- Шаг 8a (СТАРТ ФАЗЫ C): РЕЕСТР КАНАЛОВ + ПЕРЕКЛЮЧАТЕЛЬ ТЕКУЩЕГО КАНАЛА в /menu.
  По `ПЛАН.md` Шаг 8 = «активировать channelId везде, ОДИН владелец → много каналов» (мульти-клиент с
  шифрованием токенов — Шаг 9). Решения сессии: канал пока один (@sofia_gada1ka), но скоро будет 2-й на
  ДРУГУЮ тематику (тест ниша-независимости) → UI добавления нужен; Шаг 8 РАЗБИТ на подсессии, эта = 8a.
  ⚙️ Ключевой факт: схема БД мультиканальна с Шага 1 (все таблицы и функции доступа уже с `channelId`).
    Одноканальным был только РЕЗОЛВ: `getActiveChannel`/`getPostingChannel` через `findFirst` брали
    «первый активный». 8a = заменить резолв В МЕНЮ на «текущий выбранный канал». Миграций НЕТ.
  Слои:
  - `core/menu/selectChannel.ts` — ЧИСТАЯ `pickSelectedId(selectedId, channels)` (выбранный, если ещё
    в списке; иначе первый; иначе null), под тестами (tests/selectChannel.test.ts, 4 шт.).
  - `telegram/features/admin/channelContext.ts` — НОВЫЙ модуль контекста: in-memory `Map<adminId,
    channelId>` (как `PendingInput` Шага 3, эфемерно → фолбэк на первый канал при рестарте);
    `setSelectedChannel`, `resolveChannelMenu` (список+текущий id одним запросом), `resolveSelectedChannel`
    / `resolvePostingChannelSelected` — **drop-in замены** `getActiveChannel`/`getPostingChannel` с теми
    же типами возврата (по выбранному id через `getChannelById`/`getPostingChannelById`).
  - `db/repositories/channelRepository.ts` — +5 функций: `getChannelById`, `getPostingChannelById`,
    `listChannels` (+тип `ChannelListItem` с niche), `createChannel({title})` (пустой канал, niche "—",
    остальное дефолты схемы — ОТДЕЛЬНО от `upsertChannel` сида), `setChannelActive`.
  - `telegram/features/admin/screens.ts` — раздел «📡 Каналы» в `MAIN_SECTIONS` (первым); `renderMain`
    стал async и показывает ШАПКУ с текущим каналом; новые рендереры `renderChannels` (список ●текущий/
    ○активный/🔇выкл, кнопка слова = выбрать, ⚙️ = карточка, ➕ добавить), `renderChannelDetail` (сводка +
    сделать текущим / цель публикации / вкл-выкл), `renderAddChannelPrompt`. ВСЕ ~19 вызовов
    `getActiveChannel`/`getPostingChannel` заменены на резолверы контекста (sed, типы совпали).
  - `telegram/features/admin/index.ts` — ветки роутера `ch`/`chsel`/`chadd`/`chd`/`chtgt`/`chact`
    (протокол `m:`, индексы ≤64б); `PendingInput`+`{kind:"addChannel"}`, `handleInput` создаёт канал
    ДО проверки на наличие канала (это может быть самый первый); ~15 вызовов резолва заменены;
    `renderMain()` → `await renderMain(deps)`.
  ⚠️ ИЗОЛЯЦИЯ (рантайм НЕ трогали): `postingService`, `triggerStage`, `weeklyReportService`,
    `analyticsService`, `approval/index` по-прежнему берут ПЕРВЫЙ активный канал (`findFirst`) → добавив
    2-й канал, владелец его НАСТРАИВАЕТ из меню, но автопостинг/ответы в комментах ведёт только канал
    №1, пока не сделаны 8b (мультиканальный автопостинг) и 8c (маршрутизация триггеров по группе).
    Карточка канала это поясняет.
  Проверки зелёные: tsc 0, eslint 0, vitest **137/137** (+4 selectChannel), build (`prisma generate &&
  tsc`) ок. Миграций/новых env/npm-зависимостей НЕТ. Локальный запуск НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций нет). Раздел «📡 Каналы» появится сам;
    поведение рантайма не меняется (один канал).
  ⏳ Ручная проверка в TG (за пользователем): `/menu` показывает текущий канал в шапке; «📡 Каналы» →
    «➕ Добавить канал» → ввести название → канал создан и стал текущим; зайти в «💬 Триггеры»/«🗂
    Контент-план» при выбранном новом → ПУСТО (его данные), при выбранном таро → старые данные;
    переключиться обратно. Автопостинг/комменты по-прежнему ведут канал №1 (это нормально до 8b/8c).
- Шаг 8b: МУЛЬТИКАНАЛЬНЫЙ АВТОПОСТИНГ. Закрыт разрыв 8a (стр. 581–585): рантайм автопостинга больше
  не берёт «первый активный» канал — планировщик обходит ВСЕ активные, тест-кнопки бьют по выбранному
  в меню каналу, одобренный пост уходит в СВОЙ канал. Триггеры в комментах — это 8c, НЕ трогали;
  мультиканальная аналитика (отчёт/напоминалка) — вне объёма 8b (остаётся на первом канале).
  ⚙️ Чисто рантаймовая правка: миграций/env/npm-зависимостей НЕТ. Схема мультиканальна с Шага 1,
    настройки автопостинга уже пер-канальные (`autopostSettings` — всё с `channelId`). Менялся только
    РЕЗОЛВ канала.
  Слои:
  - `db/repositories/channelRepository.ts` — `listPostingChannels` (все `isActive`, тот же `select`/тип
    `PostingChannel`, что у `getPostingChannel`; orderBy `createdAt asc` → канал №1 первый).
    `getPostingChannel` ОСТАВЛЕН (его ещё используют `analyticsService`/`weeklyReportService`).
  - `services/postingService.ts`:
    - Планировщик разнесён: `publishDuePosts(deps)` берёт `listPostingChannels` и в цикле зовёт новый
      `publishDuePostsForChannel(deps, channel)` с ИЗОЛЯЦИЕЙ ошибок per-channel (try/catch +
      `logger.error({channelId})`) — сбой одного канала не роняет остальные. Внутренний дедуп/прогресс/
      гейт одобрения и так по `channel.id` — не менялись.
    - `publishNow(deps, channelId)` и `requestApprovalForPost(deps, channelId, externalId)` — теперь
      принимают `channelId`, резолв через `getPostingChannelById` (вместо `getPostingChannel`).
    - `publishPending(deps, pendingId)` — резолвит канал по `pending.channelId` (а не «первый активный»):
      одобренный пост публикуется в тот канал, для которого создан снимок.
    - Импорты: `getPostingChannel` → `getPostingChannelById` + `listPostingChannels`.
  - `telegram/features/admin/index.ts` — кнопки `apub` («📤 Опубликовать сейчас») и `ptest`
    («👀 Прислать на тест») сначала `resolveSelectedChannel(deps)` (контекст выбранного канала 8a),
    при null → тост «Канал не найден», иначе передают `channel.id` в сервис.
  - `telegram/features/approval/index.ts` — `currentTarget(deps, channelId)` через `getPostingChannelById`;
    на 3 точках (reroll/own/edit) передаём `updated.channelId` → подпись превью «куда уйдёт» совпадает с
    реальным каналом поста. `publishPending(...)` на месте (канал берётся внутри из `pending.channelId`).
  Проверки зелёные: typecheck 0, lint 0, vitest **137/137** (нового чистого ядра нет — оркестрация в
    сервисном слое, который тестами не покрывается; существующий `tests/posting.test.ts` не задет),
    build (`prisma generate && tsc`) ок. Локальный запуск НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код (миграций/ключей/сида нет). С ОДНИМ каналом поведение
    не меняется. Чтобы пошёл 2-й канал — добавить его в `/menu → 📡 Каналы`, задать ему цель
    («📅 Автопостинг → 📡 Указать канал»), времена и включить тумблер; бот должен быть админом того канала.
  ⏳ Ручная проверка в TG (за пользователем): добавить 2-й канал, задать цель+времена, включить
    автопостинг → тик публикует в ОБА канала; «📤 Опубликовать сейчас»/«👀 Прислать на тест» при
    выбранном 2-м канале действуют на НЕГО; одобрить ждущий пост 2-го канала → уходит в цель 2-го канала.
- Шаг 8c: МАРШРУТИЗАЦИЯ ТРИГГЕРОВ В КОММЕНТАХ ПО ГРУППЕ ОБСУЖДЕНИЯ. Закрыт последний разрыв
  одноканального резолва рантайма (стр. 584–587): `triggerStage` больше не берёт «первый активный»
  канал — коммент обрабатывается данными (слова/пулы/кулдаун/`comments_enabled`) СВОЕГО канала.
  Сделано «надёжнее для многих каналов» (запрос владельца): маршрут по группе обсуждения, но
  БЕЗ миграции и БЕЗ ручной настройки — связь группа↔канал АВТО-ОБУЧАЕТСЯ.
  ⚙️ Чисто рантаймовая правка: миграций / новых env / npm-зависимостей НЕТ. Связь хранится в
    существующей таблице `Setting` (ключ `discussion_chat_id`, значение = id группы строкой).
  Логика выбора канала (по убыванию надёжности):
    1) выученная связь: канал с `Setting.discussion_chat_id == String(ctx.chat.id)` (и активен) —
       покрывает ВСЕ комменты, включая вложенные ответы;
    2) `reply_to_message.sender_chat` автопересланного корневого поста
       (`is_automatic_forward === true`) — origin-канал, сопоставляется по `username`/`chatId`;
       покрывает верхнеуровневые комменты (там и пишут слова) до того, как связь выучена;
    3) фолбэк — первый активный канал (прежнее одноканальное поведение, без регрессии).
    АВТО-ОБУЧЕНИЕ — побочный эффект сигнала 2: опознали канал по sender_chat, а группа ещё не
    привязана → пишем `Setting`. Первый же верхнеуровневый коммент под постом обучает связь;
    дальше вложенные ответы идут по сигналу 1. Связь в БД → переживает рестарт. Композер не трогали.
  Слои:
  - `core/comments/routeChannel.ts` — НОВЫЙ, ЧИСТАЯ логика под тесты: `RoutableChannel`,
    `SenderChatRef`, `matchChannelBySenderChat` (нормализация username/chatId: нижний регистр,
    срез ведущего `@`; сверка по username и числовому id), `resolveCommentChannel`
    (приоритет выученный→sender_chat→первый→null), `const DISCUSSION_GROUP_SETTING`.
  - `db/repositories/channelRepository.ts` — `getActiveRoutableChannels` (active, select id/username/
    chatId/triggerWords, orderBy `createdAt asc` → `[0]` = прежний фолбэк), `findChannelIdByDiscussionGroup`
    (`setting.findFirst` по key+value+relation `channel.isActive`), `setDiscussionGroup`
    (обёртка над `setJsonSetting`).
  - `telegram/features/comments/triggerStage.ts` — блок резолва заменён на маршрутизацию (см. выше);
    при exactOptionalPropertyTypes `username` собираем условным spread; остальной поток (пул/кулдаун/
    ответ) НЕ менялся, тип `channel` теперь `RoutableChannel` (поля `id`/`triggerWords` на месте).
    Импорт `getActiveChannel` убран из стадии (сама функция в репозитории ОСТАВЛЕНА).
  - `tests/commentRouting.test.ts` — НОВЫЙ, 10 тестов (matchChannelBySenderChat + resolveCommentChannel).
  Проверки зелёные: typecheck 0, lint 0, vitest **147/147** (+10). Миграций/env/зависимостей НЕТ.
    Локальный запуск НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код. С одним каналом поведение не меняется (фолбэк = тот же
    первый активный). Для мультиканальности бот должен быть в группе обсуждения КАЖДОГО канала.
  ⏳ Ручная проверка в TG (за пользователем): два канала с разными словами и их группами обсуждения;
    слово канала А в группе А → ответ по данным А; слово канала Б в группе Б → ответ по данным Б;
    вложенный ответ в группе Б после первого коммента → тоже канал Б (связь выучена).
- Шаг 9a: ОНБОРДИНГ КАНАЛА + ПРОВЕРКА ПРАВ. Закрыт первый пункт Шага 9 «подключи канал → работает».
  Раньше владелец вручную создавал канал в `/menu` (только title) и вручную вписывал цель публикации;
  `username` из меню не сохранялся, права бота нигде не проверялись (в `src/` 0 вызовов
  `my_chat_member`/`getChatMember`). Теперь: добавил бота админом в канал → бот ловит событие,
  авто-регистрирует канал (`chatId`/`username`/`title`), проверяет право публиковать, пишет владельцу.
  📐 РЕШЕНИЕ ПО ОБЪЁМУ (с пользователем): Шаг 9 разбит — делаем ТОЛЬКО 9a (онбординг + проверка прав).
    Пер-канальные настройки уже были (`Setting(channelId,key)`). ШИФРОВАНИЕ bot-токенов клиентов —
    ОТЛОЖЕНО: проект одно-ботовый (общий `BOT_TOKEN` из env), у `Channel` нет поля `botToken`,
    клиентских токенов в БД нет → шифровать нечего. Это часть будущего мультибот-форка (отдельный план).
  ⚙️ Чисто рантаймовая правка: миграций / новых env / npm-зависимостей НЕТ. Переиспользованы
    существующие поля `Channel` (`chatId`/`username`/`title`/`isActive`).
  Слои:
  - `core/onboarding/membership.ts` — НОВЫЙ, ЧИСТАЯ логика под тесты: `classifyBotMembership`
    (переход old→new статуса → `promoted`/`demoted`/`removed`/`unchanged`; `removed` важнее `demoted`),
    `extractRights(status, canPostMessages?)` (мост grammY→примитивы: creator имеет все права,
    у administrator право публикации из `can_post_messages`), `evaluateChannelRights`
    (недостающие права + сводка для DM).
  - `db/repositories/channelRepository.ts` — НОВЫЕ: `findChannelByChatId` (`findFirst`, chatId не unique),
    `registerChannelFromOnboarding` (идемпотентно: ищет по `username` @unique → по `chatId` → линкует
    и включает, иначе создаёт с нишей-заглушкой «—»; возвращает `{id, created}`).
  - `telegram/features/onboarding/index.ts` — НОВЫЙ композер на `my_chat_member` (только `chat.type
    === "channel"`). promoted → регистрация + DM «канал подключён» + сводка прав; demoted/removed →
    DM-предупреждение (канал НЕ деактивируем авто). DM в try/catch на `GrammyError` (владелец не нажал
    /start). Подключён в `telegram/bot.ts` последним (не пересекается по типу апдейта).
  - `telegram/features/admin/{screens,index}.ts` — кнопка «🛡 Проверить права» в карточке канала
    (`encodeCb("chk", idx)`) + `renderRightsCheck` (чистое форматирование); ветка `case "chk"` делает
    живой `ctx.api.getChatMember(chatId, ctx.me.id)` → `extractRights`/`evaluateChannelRights` → экран;
    `chatId === null` → подсказка-алерт; `GrammyError` (бот не в чате/не админ) → дружелюбный экран.
  - `tests/onboarding.test.ts` — НОВЫЙ, 14 тестов (classifyBotMembership + extractRights + evaluateChannelRights).
  Проверки зелёные: typecheck 0, lint 0, vitest **161/161** (+14). Миграций/env/зависимостей НЕТ.
    Локальный запуск НЕ делали (токен поллит Railway → 409).
  ⚠️ Прод (Railway): деплой только обновит код. Чтобы онбординг сработал, бот должен получить право
    видеть `my_chat_member` — это даётся автоматически, когда его делают администратором канала.
  ⏳ Ручная проверка в TG (за пользователем): добавить бота админом в тест-канал → приходит DM
    «✅ Канал подключён» + права, канал линкуется/появляется в `/menu → 📡 Каналы` с заполненным chatId;
    снять право «Публикация» → «🛡 Проверить права» в карточке показывает «❌ нет права»; убрать бота
    из канала → приходит предупреждение; повторное добавление того же канала НЕ плодит дублей.
- Доработка 9a+ (UI меню): НАСТРАИВАЕМЫЙ КУЛДАУН + удаление тестовой публикации. Две правки
  интерфейса по запросу владельца.
  1) КУЛДАУН был захардкожен `COOLDOWN_HOURS = 24` в трёх местах (screens, triggerStage,
     postButtons), а кнопка «⏱ Кулдаун» в Настройках — заглушка `encodeCb("soon")`. Теперь
     кулдаун — настройка канала поверх таблицы `Setting` (тот же паттерн, что у автопостинга).
     - `services/cooldownSettings.ts` — НОВЫЙ: `COOLDOWN_KEY="cooldown_hours"`,
       `DEFAULT_COOLDOWN_HOURS=24`, `readCooldownHours`/`setCooldownHours` (через get/setJsonSetting).
     - `core/menu/validation.ts` — НОВЫЙ `validateCooldownHours`: целые часы 0…168
       (`MAX_COOLDOWN_HOURS=168`), отдельный тип `NumberValidationResult` (несёт number, не string).
       Решение пользователя: формат — ЦЕЛЫЕ ЧАСЫ; `0` = выключить кулдаун.
     - `0` без спец-кейсов: `nextExpiry(now,0)=now`, `isOnCooldown` строгий `>` → срабатывает
       всегда; анти-повтор `recent` продолжает работать. `cooldown.ts` НЕ менялся.
     - admin/`types.ts` — `PendingInput` + `{kind:"setCooldown"}`; admin/`screens.ts` — хелпер
       `cooldownLabel` («N ч»/«выкл»), `renderSettings`/`renderStatus` читают значение, кнопка →
       `encodeCb("cd")`, новый `renderSetCooldownPrompt`; admin/`index.ts` — case `"cd"` (вход в
       ввод) + input-case `"setCooldown"` (валидация → `setCooldownHours` → назад в Настройки).
     - triggerStage/postButtons: убрана локальная константа, перед `saveCooldown` читаем
       `readCooldownHours(prisma, channelId)`.
  2) Удалена кнопка «📤 Опубликовать сейчас (тест)» (`apub`) из экрана автопостинга: публиковала
     первый пост дня сразу в основной канал мимо расписания/одобрения — не нужна. Снято:
     строка-кнопка в `renderAutopost`, `case "apub"` и хелпер `publishResultText` в admin/index,
     функция `publishNow` + тип `PublishNowResult` в `postingService.ts` (использовались только тут;
     `getPostsForDay` и пр. остаются — нужны планировщику).
  Тесты: `tests/schedule.test.ts` +5 кейсов `validateCooldownHours`. Проверки зелёные:
  typecheck 0, lint 0, vitest **165/165**. Миграций/env/зависимостей НЕТ (ключ живёт в `Setting`).
  ⏳ Ручная проверка в TG (за пользователем): Настройки → «⏱ Кулдаун» → ввод числа → значение
    видно в Настройках и Статусе; ввод `0` → подпись «выкл», триггер срабатывает без задержки;
    в Автопостинге больше нет кнопки «Опубликовать сейчас (тест)».
- Шаг 6c: РАЗОВЫЙ ПОСТ В РАСПИСАНИЕ (одиночная публикация по дате-времени). Раньше посты
  создавались ТОЛЬКО сидом, в меню — лишь правка/удаление. Теперь из `/menu → Контент-план →
  ➕ Новый пост (разовый)` мастер собирает пост и планирует его на конкретный момент; тик
  планировщика публикует один раз. Объём (выбор владельца): полный интерактив + фото
  Pexels/загрузка.
  📐 АРХ-РЕШЕНИЕ: разовый пост — строка в ТОЙ ЖЕ таблице `Post` с `oneOff=true` (а не отдельная
    таблица). Причина: нажатие `button_choice` резолвит вариант через `getPostInteractive(channelId,
    externalId)` из `Post`; отдельная таблица сломала бы протокол кнопок. Так `button_choice`/
    `button_prediction`/`buildPostKeyboard`/`resolvePhoto`/`getPostToPublish` работают без правок.
    `week/day/slot` у oneOff — плейсхолдеры (0/monday/morning/00:00); в недельные выборки строка
    не попадает (фильтр `oneOff:false` в `getPostsForDay`/`getPlanOverview`/`getPostsForWeek`).
  Под-шаги (3 коммита):
  - 6c-1 ДАННЫЕ: миграция `Post` +`oneOff`/`publishAt`/`publishedAt`/`photoFileId` (+индекс
    `[oneOff,publishedAt,publishAt]`). НОВОЕ `core/schedule/parseDateTime.ts` — чистый перевод
    «стена пояса → UTC» (2 прохода ради DST) + круговая проверка несуществующих дат; обёртка
    `validateDateTime` в `core/menu/validation.ts` (формат `ДД.ММ[.ГГГГ] ЧЧ:ММ`, не в прошлом).
    Репо: `nextExternalId`/`createOneOffPost`/`getDueOneOffPosts`/`markOneOffPublished`;
    `photoFileId` → источник `photoUrl` (высший приоритет, шлётся как строка-file_id).
    Тесты: +9 (`parseDateTime`/`validateDateTime`).
  - 6c-2 ПУБЛИКАЦИЯ: `postingService.publishDueOneOffPosts(deps)` — `getDueOneOffPosts(now)` →
    `resolvePhoto`+`sendPost`+`postKeyboard` → `markOneOffPublished` (только после успешной
    отправки). Минует одобрение (мастер уже дал предпросмотр). Нет цели → откладываем; канал
    удалён → помечаем; уведомление админу об успехе/ошибке. Вызов из тика рядом с `publishDuePosts`.
  - 6c-3 МАСТЕР (меню): кнопка «➕ Новый пост» в `renderPlan`; черновик `NewPostDraft` в
    in-memory Map (как `PendingInput`). Шаги: заголовок→текст→CTA → тип интерактива (4 кнопки;
    `button_choice`=цикл «метка | ответ», `button_prediction`=выбор пула+подпись, прочие=без
    кнопок) → фото (Pexels-запрос / загрузка картинки / без) → дата-время → предпросмотр →
    «✅ Запланировать» (`createOneOffPost`). НОВЫЙ обработчик `message:photo` (ловит фото только
    когда мастер ждёт `npPhotoUp`). Callback-протокол: `np`/`npit`/`npcd`/`nppl`/`npph`/`npsave`/
    `npx`; не-`np` кнопка сбрасывает черновик.
  Проверки зелёные: typecheck 0, lint 0, vitest **174/174** (+9). Миграция применена локально
    (`aicm_dev`); новых env/зависимостей НЕТ.
  ⚠️ Прод (Railway): нужна `prisma migrate deploy` (есть в `npm start`) — добавились колонки `Post`.
  📌 ОГРАНИЧЕНИЕ: «ответные комменты под пост» НЕ пер-постовые — триггеры остаются глобальной
    настройкой канала (`triggerWords`+`comments_enabled`). Тип `keyword_trigger` у разового
    поста = просто «без кнопок».
  ⏳ Ручная проверка в TG (за пользователем): `/menu → Контент-план → ➕ Новый пост` → пройти
    мастер с `button_choice` и загруженным фото, дата-время на +2 мин → дождаться публикации →
    пост ушёл с фото и кнопками, кнопка-вариант показывает ответ, повторно НЕ публикуется;
    разовый пост НЕ виден в списке недель контент-плана.
- Хотфикс: MTPROTO-СЕССИЯ ОТОЗВАНА + BOT.CATCH + КНОПКА МЕНЮ. Инцидент в проде (Railway):
  тест-отчёт по просмотрам падал с `RPCError: 401: AUTH_KEY_UNREGISTERED`, логи забиты
  бесконечными `TIMEOUT … updates.js _updateLoop`, у админа пропала reply-кнопка «📋 Меню».
  🔍 ДИАГНОЗ: причина 401 НЕ в коде — Telegram отозвал MTProto-сессию (строка
    `TELEGRAM_SESSION` в env Railway мертва; сессию завершили в «Устройствах» либо один
    session-string использовался с двух IP одновременно). Спам тайм-аутов — потому что
    `disconnect()` у GramJS не убивает внутренний update-loop. Кнопка меню — reply-клавиатура
    ставится только на `/start` (восстановление: послать `/start`).
  Код (3 правки):
  - `weeklyReportService.ts`: в `collectReport` finally → `client.destroy()` вместо
    `disconnect()` (гасит update-loop и спам). Новый хелпер `isSessionRevokedError`
    (`/AUTH_KEY/i` по `String(err)` — без статического импорта GramJS, принцип 7b) + текст
    `SESSION_REVOKED` с инструкцией перегенерации. Тест-кнопка шлёт его вместо сырого RPCError;
    джоб ПН 09:30 при мёртвой сессии теперь тоже уведомляет админа (иначе отчёты молча
    пропали бы навсегда).
  - `index.ts`: `bot.catch` (ошибка хендлера больше не роняет long polling) +
    `process.on("unhandledRejection")` — критичный пункт из `ОТЧЁТ-ПРОВЕРКИ-2026-07-03.md`.
  - `index.ts`: `bot.api.setMyCommands([menu, start])` при старте (в try/catch) — постоянная
    синяя кнопка «Menu» у поля ввода, вход в меню не теряется даже без reply-клавиатуры.
  Проверки зелёные: typecheck 0, lint 0, vitest **174/174**. Миграций/зависимостей НЕТ.
  ⚠️ Прод (Railway) — ручные шаги ОБЯЗАТЕЛЬНЫ, без них отчёт не оживёт:
    1) локально `npm run gen-session` (или `gen-session-qr`) → новая строка сессии;
    2) Railway → Variables → заменить `TELEGRAM_SESSION` → redeploy;
    3) в TG послать боту `/start` → вернётся кнопка «📋 Меню»;
    4) НЕ запускать локального бота с тем же `TELEGRAM_SESSION` одновременно с Railway.
  ⏳ Ручная проверка в TG (за пользователем): после шагов выше — Меню → Аналитика →
    «Прислать отчёт по просмотрам (тест)» → приходит отчёт; рядом с полем ввода снова есть
    синяя кнопка Menu (/menu, /start); логи Railway без спама TIMEOUT.
  ➕ Догонка (тот же день): после деплоя бот замолчал — 409 Conflict от getUpdates (старый
    контейнер Railway ещё поллил при передеплое), `bot.start()` отклонился, а связка
    `void main()` + новый `unhandledRejection` оставила процесс жить «зомби» (health-сервер
    держит, поллинга нет). Фикс: `main().catch(...) → process.exit(1)` — хостинг перезапускает
    процесс, поллинг восстанавливается сам.
- АУДИТ НАДЁЖНОСТИ ДЛЯ АВТОНОМНОЙ РАБОТЫ (повторная проверка + 4 фикса). Независимый аудит
  всего рантайм-кода (~8400 строк) перед автономным автопостингом; план по уровням —
  `~/.claude/plans/purring-booping-puzzle.md`. Прошлый критичный пункт (bot.catch и т.д.)
  подтверждён исправленным. Найдено и исправлено:
  - 🔴 НАЛОЖЕНИЕ ТИКОВ ПЛАНИРОВЩИКА: croner по умолчанию НЕ блокирует новый тик, пока идёт
    предыдущий (`protect` не задан). Долгий тик (>60с: каналы × Pexels 8с × Telegram) →
    параллельный второй тик читает старый прогресс → ДУБЛИ постов в канале (то же с
    разовыми постами). Фикс: `protect: true` во всех трёх `new Cron(...)`
    (`scheduler/index.ts` autopost, `scheduler/analytics.ts` оба джоба).
  - 🟡 429/СЕТЬ БЕЗ ПОВТОРА: пост/превью терялись при rate limit; плюс любая не-parse ошибка
    `sendPhoto` (в т.ч. транзиентная) уводила пост в текст БЕЗ фото. Фикс: зависимость
    `@grammyjs/auto-retry` + `bot.api.config.use(autoRetry())` в `index.ts` (действует и на
    планировщик — он шлёт через тот же `bot.api`).
  - 🟡 ПРОГРЕСС ОДНИМ КУСКОМ: `publishDuePostsForChannel` писал `postedTimes` после всего
    цикла → рестарт/redeploy посреди цикла повторно публиковал уже отправленное. Фикс:
    `saveProgress` в `finally` после КАЖДОГО времени. Тест: ошибка первой публикации →
    upsert-прогресс всё равно на каждое время.
  - 🟡 ОНБОРДИНГ ОТ КОГО УГОДНО: бот публичный — любой мог добавить его админом в СВОЙ канал,
    и тот молча регистрировался активным в реестре владельца. Фикс: в `my_chat_member`
    проверка `upd.from.id === deps.adminId`, чужие — warn-лог и игнор. Тесты композера:
    от владельца → регистрация+DM; от чужого → ни записи в БД, ни DM.
  Проверки зелёные: typecheck 0, lint 0, vitest **177/177** (+3). Миграций НЕТ; новая
    прод-зависимость `@grammyjs/auto-retry`.
  📌 БЭКЛОГ ИЗ АУДИТА (🟢, не делали): vitest@4 (закрыть dev-уязвимости npm audit);
    MarkdownV2 вместо легаси Markdown; @grammyjs/runner при росте нагрузки (сейчас долгий
    хендлер, напр. MTProto-отчёт, блокирует очередь апдейтов); TTL для PendingPost;
    отчёт по просмотрам мультиканально.
  ⏳ Ручная проверка в TG (за пользователем): разовый пост + автопост в @supertestmaster
    уходят ровно по одному разу; добавить бота в тест-канал со ВТОРОГО аккаунта (не админ) —
    канал НЕ появляется в «📡 Каналы» и DM не приходит.
- UX АДМИН-МЕНЮ (базовый пакет) + БЕЗОПАСНЫЙ РЕФАКТОРИНГ. Второй проход после аудита
  надёжности: владельцу меню было «непонятно», плюс уборка кода без риска.
  - ГЛАВНОЕ МЕНЮ: `MAIN_SECTIONS` → ряды по 2 кнопки, сгруппированные по смыслу
    (контент → публикация → комменты → канал → сводки); «➕ Новый пост» вынесен на
    главную (тот же callback `np`, в Контент-плане тоже остался); кнопка-заглушка
    «⏳ AI-ответы (скоро)» убрана с главной (строка про AI живёт в Настройках);
    «📊 Аналитика» → «📈» (различима со «📊 Статус»); короткая легенда в тексте экрана.
    ⚠️ Callback-коды НЕ менялись — кнопки в старых сообщениях чата работают.
  - ТЕКСТЫ: удалена устаревшая подсказка в карточке канала «мультиканальный рантайм —
    следующий подшаг (8b/8c)» (8b/8c давно сделаны) → актуальная про мультиканальность;
    `noChannelScreen` больше не шлёт владельца в консоль («Запусти сид») — ведёт в
    «📡 Каналы → ➕» + кнопка, сид упомянут как примечание разработчику; единый термин
    «🎯 Канал публикации» вместо «📡 Указать канал» (кнопка автопостинга, промпт, тексты
    ошибок в approval/postingService/weeklyReportService, previewResultText).
  - РЕФАКТОРИНГ: новый чистый `core/text/pluralRu.ts` (`pluralRu(n, [один, несколько,
    много])`) вместо ТРЁХ копий правила склонений в `screens.ts`; +4 теста
    (`tests/plural.test.ts`, границы 1/11/21/104/111).
  - ОСОЗНАННО НЕ ДЕЛАЛИ (решение, не долг): оптимизация числа запросов к БД на клик меню
    (3–6 запросов — для одного админа выигрыша нет, риск есть); дедупликация экранов
    триггеров/пулов (~150 строк, средний риск — отложено); vitest@4 / MarkdownV2 /
    runner / TTL PendingPost — бэклог прошлого аудита.
  Проверки зелёные: typecheck 0, lint 0, vitest **181/181** (+4). Миграций/зависимостей НЕТ.
  ⏳ Ручная проверка в TG (за пользователем): `/menu` — сгруппированное меню 2×5;
    «➕ Новый пост» с главной запускает мастер; «🏠 Домой» отовсюду ведёт на новую главную;
    кнопки в старом сообщении меню (до обновления) продолжают работать.
- ШАГ 10a — ФУНДАМЕНТ AI-ГЕНЕРАЦИИ ПОСТОВ (старт Шага 10, главный приоритет продукта).
  Контекст: прошлые сессии застряли на ФАНТОМЕ — ссылались на «уже готовый 10a», которого
  в репо не было (ни AI-кода, ни файла плана; и локальный, и origin/main на 5931a92). Эта
  сессия создаёт сам фундамент, ИЗОЛИРОВАННО (без правок меню/схемы БД/approval), чтобы 10b
  встал поверх без конфликтов и без риска для параллельной сессии.
  - КОНФИГ: `ANTHROPIC_API_KEY` (опционален, как PEXELS_API_KEY) в `config/env.ts` — нет
    ключа → генерация тихо отключена, бот работает как раньше. Новая прод-зависимость
    `@anthropic-ai/sdk` (^0.110).
  - ЧИСТОЕ ЯДРО `core/ai/` (покрыто тестами, без сети):
    · `postDraft.ts` — zod-схема + тип `PostDraft` {title, text, cta, pexelsQuery} +
      `parsePostDraft` / `parsePostDraftJson` (снимает ```json-ограждение). Пустой
      pexelsQuery → null; лишние ключи отброшены; обязательные — строги.
    · `buildPostPrompt.ts` — детерминированная пара system/user из названия канала +
      примеров его постов (тон выводится из постов канала, тематики в коде нет —
      niche-agnostic); тема опциональна (в 10a AI выбирает сам, ввод темы — 10b).
  - СЕРВИС `services/ai/aiGenerationService.ts` — `generatePostDraft(deps, input, client?)`:
    сеть изолирована за интерфейсом `AiTextClient` → тестируется фейком, без вызовов API.
    Модель `claude-opus-4-8` (`GENERATION_MODEL`), Structured Outputs (json_schema) → чистый
    JSON → валидация zod. Нет ключа/ошибка сети/парсинга → `null` (мягкая деградация, как
    genProvider без ключа Pexels; вызывающий не падает).
  - РЕПО: `getSamplePosts(channelId, limit)` в `postRepository` — образцы стиля из плана.
  - DEV-ХАРНЕС `scripts/tryGeneratePost.ts` (`npm run try-ai`) — по первому активному каналу
    печатает JSON-черновик; ничего не публикует и не пишет в БД, только читает.
  - ПОЧЕМУ pexelsQuery уже в контракте: заранее закрывает пункт 10b «расширение контрактов»
    и готовит починку «🔄 Другое фото» для AI-постов.
  Проверки зелёные: typecheck 0, lint 0, vitest **194/194** (+13, `tests/ai.test.ts`).
    Миграций НЕТ. Новая зависимость `@anthropic-ai/sdk`.
  ⚠️ Прод-нюанс: чтобы генерация реально работала, добавить `ANTHROPIC_API_KEY` в env Railway.
  ⏳ Ручная проверка (за пользователем): в `.env` есть ANTHROPIC_API_KEY + засеянная БД
    (`npm run seed`) → `npm run try-ai` печатает валидный `{title, text, cta, pexelsQuery}` в
    тоне таро-канала; без ключа — понятное сообщение, без падения.
  ДАЛЬШЕ 10b: миграция `PendingPost.pexelsQuery` + репо; обобщение `requestApproval` через
    `ApprovalDraft`; `requestAiPostApproval` (черновик → очередь одобрения); починка
    «🔄 Другое фото» для AI-постов (fallback на `pending.pexelsQuery`); кнопка «🤖 AI-пост»
    в админ-меню; проброс `ANTHROPIC_API_KEY` в `BotDeps`/`PostingDeps`.
- ШАГ 10b — AI-ПОСТ В ОЧЕРЕДЬ ОДОБРЕНИЯ + КНОПКА В МЕНЮ (продолжение Шага 10). 10a дал
  генерацию черновика; 10b довёл её до продукта: админ жмёт «🤖 AI-пост» → бот пишет пост
  голосом канала → кладёт его в ТУ ЖЕ очередь одобрения, что и плановый пост (общий код),
  так что «✅ Опубликовать» / «✍️ Изменить текст» / «🔄 Другое фото» работают без правок.
  - МИГРАЦИЯ: `PendingPost.pexelsQuery String?` (`20260704073430_step10b_pending_pexels_query`)
    — снимок запроса подбора фото, чтобы reroll работал у AI-постов (у них нет `externalId`,
    т.е. строки в контент-плане, откуда раньше брался `pexelsQuery`). Проведено через
    `pendingPostRepository`: `PendingPostRow` + `PendingPostInput` + `SELECT` + `createPending`.
  - ОБОБЩЕНИЕ ОЧЕРЕДИ (`postingService`): новый `ApprovalDraft {title,text,cta,externalId,
    pexelsQuery,photoSources}` + `requestApprovalForDraft(...)` — единый путь постановки
    ЛЮБОГО снимка в очередь (плановый и AI). Старый `requestApproval(post: PostToPublish)`
    стал тонкой обёрткой над ним (поведение планового пути прежнее, теперь ещё кэширует
    `pexelsQuery`). +тест: AI-черновик (externalId=null) → снимок с pexelsQuery + превью.
  - СЕРВИС `services/ai/aiPostApprovalService.ts` — `requestAiPostApproval(deps, channelId)`:
    ключ → канал → `getSamplePosts` → `generatePostDraft` → `requestApprovalForDraft`
    (externalId=null, фото предзагружаем по `pexelsQuery` черновика). Проверки от дешёвых к
    дорогим; результат-union `{no_key|no_channel|no_samples|gen_failed}` → понятный тост/
    сообщение админу, НЕ исключение (кнопка меню не роняет обработчик). +тест: нет ключа → no_key.
  - ПОЧИНКА «🔄 Другое фото» (`features/approval`, `handleReroll`): было — при externalId=null
    отказ. Стало — запрос фото берём из контент-плана (`getPostPhotoSources`) у планового
    поста, из `pending.pexelsQuery` у AI-поста. Плановый путь не тронут.
  - КНОПКА «🤖 AI-пост»: широкая строка в `MAIN_SECTIONS` (после «Новый пост») — флагманская
    фича, выделяется; callback `aigen`. Хендлер: нет канала → тост; иначе отвечаем на callback
    сразу («🤖 Генерирую пост… ⏳», т.к. генерация идёт секунды и callback мог бы протухнуть),
    затем `requestAiPostApproval` — превью/ошибка приходят отдельным сообщением.
  - ПРОВОД КЛЮЧА: `ANTHROPIC_API_KEY` из `index.ts` → `BotDeps` → `AdminDeps` (`anthropicApiKey`).
    `ApprovalDeps` ключ НЕ нужен (reroll AI-поста лишь заново дёргает Pexels по `pexelsQuery`).
  Проверки зелёные: typecheck 0, lint 0, vitest **196/196** (+2: `posting.test` requestApprovalForDraft,
    `ai.test` requestAiPostApproval no_key). Миграция есть (см. выше); зависимостей НЕ добавляли.
  ⚠️ Прод-нюанс: кнопка реально сгенерирует пост только с `ANTHROPIC_API_KEY` в env Railway
    (без ключа админ получит понятное сообщение «AI-генерация выключена…», без падения). На
    Railway `prisma migrate deploy` (в `npm start`) применит миграцию `pexelsQuery` сам.
  ⏳ Ручная проверка (за пользователем) в TG: `/menu` → «🤖 AI-пост» на канале с контент-планом
    и ключом → приходит превью в тоне канала → «✅ Опубликовать» публикует, «✍️ Изменить текст»
    и «🔄 Другое фото» работают; без ключа — сообщение-подсказка, бот жив.

- ШАГ 10b — ВВОД В ПРОД (что проверено вживую, кода не трогали). Владелец добавил
  `ANTHROPIC_API_KEY` в переменные сервиса бота на Railway (изначально по ошибке — в сервис
  PostgreSQL; перенесли на сервис бота, из БД удалили).
  - ДЕПЛОЙ: Railway передеплоил сам. Лог чист: `prisma migrate deploy` → «нет миграций к
    применению» (8 миграций обнаружено, `pexelsQuery` уже в БД), планировщики автопостинга и
    аналитики включились, `бот запустился` (`masterpostingbot`), статус «Активный». Ошибок нет.
  - TG-ПРОВЕРКА на `@sofia_gada1ka`: «🤖 AI-пост» → пришло превью в тоне канала (пост про
    полнолуние + фото луны + CTA «напиши слово в комментариях»); кнопки «🔄 Другое фото» и
    «✍️ Изменить текст» отработали. Кнопку «✅ Опубликовать» вживую не жали (на усмотрение
    владельца — реальная публикация подписчикам); плановый путь этой же кнопкой проверялся ранее.
  - MTProto-хотфикс аналитики (`TELEGRAM_SESSION`) — владелец подтвердил: сделан ранее.
  ⏭ Следующий подшаг — 10c (AI-подхват в автопостинге + тумблер + кнопка «👀 Предпросмотр»).

- ШАГ 10c — AI-ПОДХВАТ В АВТОПОСТИНГЕ + КНОПКА «👀 ПРЕДПРОСМОТР» (доводка Шага 10 —
  «самообновление контента»). ⚠️ Сверка с ПЛАН.md: запрошенное «автопостинг сам берёт AI»
  = сердце Шага 10, НЕ «Шаг 12» (тот про аналитику/Growth Advisor). Поведение согласовано:
  AI — запасной вариант (когда на слот нет готового поста), под тумблером; одобрение/публикация
  AI-поста подчиняются СУЩЕСТВУЮЩЕМУ тумблеру «📋 Одобрение» (новый не заводили).
  - ТУМБЛЕР (`autopostSettings`): ключ `autopost_ai_enabled` (дефолт false) + поле
    `aiEnabled` в `AutopostConfig` + `toggleAiAutopost`. UI: строка-тумблер «🤖 AI-подхват»
    в экране автопостинга (`screens.renderAutopost`) + хендлер `aitgl` (по образцу `atgl`).
  - ПРОБРОС КЛЮЧА: `anthropicApiKey` перенесён в базовый `PostingDeps` (был только в
    `AiPostApprovalDeps`, теперь тип = alias на `PostingDeps`); протянут в планировщик
    (`index.ts`), `ApprovalDeps`/`postingDepsOf`, админский `postingDeps`.
  - СБОРЩИК `buildAiDraft(deps, channel)` (выделен из `requestAiPostApproval`): ключ→образцы→
    `generatePostDraft` → `ApprovalDraft | {reason}`. `requestAiPostApproval` = обёртка
    (кнопка меню 10b без изменений). Переиспользуется автопостингом.
  - ПОДХВАТ В ТИКЕ (`publishDuePostsForChannel`): в ветке «поста нет» при `config.aiEnabled`
    → `placeAiFallbackPost`: одобрение ВКЛ → `requestApprovalForDraft`; ВЫКЛ → прямая
    публикация (`resolvePhoto`+`sendPost`). Неудача генерации → лог + уведомление админа
    один раз за день (первый пустой слот). Дедуп по `progress`; `protect:true` бережёт от
    параллельного тика. Импорт `postingService`↔`aiPostApprovalService` циклический, но
    безопасный (обе стороны — hoisted-функции, зовутся только в телах; smoke-import под Node ESM ✓).
  - КНОПКА «👀 Предпросмотр» (`callback.ts` action `preview` + `approvalKeyboard`): шлёт
    админу пост КАК В КАНАЛЕ отдельным сообщением (реальное фото + настоящие кнопки поста),
    очередь не трогает. Сборка клавиатуры вынесена из `publishPending` в
    `buildPendingPostKeyboard`; новый `sendPendingPreview`. Хендлер `case "preview"` в
    `routeApproval`. У AI-поста своих кнопок нет → текст+фото (корректно).
  Проверки зелёные: typecheck 0, lint 0, vitest **202/202** (+6: `buildAiDraft` no_key/no_samples,
    `aiEnabled` чтение + `toggleAiAutopost`, `preview` в round-trip). Миграций/зависимостей нет.
  ⏳ Ручная проверка (за пользователем) на `@supertestmaster`: (1) «🤖 AI-подхват» ВКЛ +
    одобрение ВКЛ, слот без готового поста → AI-пост на одобрение; (2) одобрение ВЫКЛ →
    публикуется сразу; (3) «👀 Предпросмотр» на любом превью → пост как в канале (у планового — с кнопками).
  ✅ Шаг 10 закрыт (память канала 10a + AI-пост 10b + самообновление 10c). Отложено в Шаге 10:
    Media Engine (AI-картинки) + роутинг моделей; ввод темы в мастер AI-поста. Дальше — Шаг 11.

- ШАГ 11a — КАЛЕНДАРЬ КОНТЕНТ-ПЛАНА + ФИКС «ПЛАН ЗАСТРЯЛ НА НЕДЕЛЕ 1». Жалоба владельца:
  «каждую неделю выходят одни и те же посты + не видно, где мы в плане». Диагностика по коду
  выявила НАСТОЯЩУЮ причину повтора (не 28-дневный цикл): `Channel.campaignStart` НИКОГДА не
  записывался — в сидже `null` (`seed/channel.ts`, комментарий «выставим на Шаге 4»), сеттер
  так и не добавили. А `resolveCampaignDay` при `start===null` всегда отдаёт `{week:1}` →
  план вечно на Неделе 1, недели 2/3/4 не наступают, крутятся те же ~8 постов.
  - ФИКС КОРНЯ (`channelRepository.ensureCampaignStart(prisma, id, date)`): идемпотентный
    якорь — ставит `campaignStart=date`, только если он ещё `null`; иначе не трогает; вернёт
    эффективный старт. Вызовы: (1) `postingService.publishDuePostsForChannel` — при первом
    активном тике, если `campaignStart===null`, якорим=сегодня ДО расчёта недели (самоисцеляет
    уже работающий `@sofia_gada1ka`); (2) хендлер `atgl` — при включении автопостинга сразу
    якорим (мгновенно верная неделя в экранах, не дожидаясь тика). Схема НЕ менялась —
    поле `campaignStart` уже было, миграции нет.
  - ЧИСТЫЙ ХЕЛПЕР (`core/schedule/postStatus.ts`, под тестами): `postStatus(today, day, time)`
    → `passed | today | upcoming` (день раньше / сегодня-время-прошло → passed; сегодня-впереди
    → today; день позже → upcoming; кривое время → today, не роняем) + `weekdayIndex` (monday=0).
  - ЭКРАН «📅 Календарь» (`screens.renderCalendar` + `MAIN_SECTIONS` широкая кнопка `cal` +
    ветка роутера `case "cal"`): текущая неделя «N из 4» + сегодняшний день + посты недели
    (`getPostsForWeek`) с маркерами ✅/▶️/🔜; строки кликабельны в тот же редактор поста
    (`pp`), что и «Контент-план»; кнопка «🗂 Весь план». Если `campaignStart` пуст — подсказка
    включить автопостинг. Навигацию по неделям в 11a НЕ делали (только текущая).
  Проверки зелёные: typecheck 0, lint 0, vitest **208/208** (+6 postStatus: границы пн/сегодня/вс,
    время до/после/ровно, кривое время). Правка теста `posting.test.ts` (дал каналу непустой
    `campaignStart`, т.к. тест про прогресс, а не про якорь — иначе лез бы в БД mock без `channel`).
  ⏳ Ручная проверка (за пользователем) в TG: `/menu` → «📅 Календарь» → видно «Неделя N из 4»,
    сегодня, маркеры ✅/▶️/🔜; тап по посту открывает редактор. Проверка advance: на проде первый
    тик автопостинга проставит `campaignStart`=сегодня, со следующей недели план пойдёт на Неделю 2.
  ⏭ Отложено на 11b (если после прохода 4 недель повтор мешает): глубокий анти-повтор на
    28-дневном лупе — AI-вариации планового поста (инфра `tryGeneratePost` готова) либо ротация
    вариантов слота с отметкой «использовано».

- ШАГ 11b — ЗАЩИТА ОТ РАСХОДА ТОКЕНОВ (фундамент Engagement Engine). Владелец делает SaaS;
  главный риск — «клиенты сожгут токены». Поэтому Модуль 5 (AI-ответы в комментах) начинаем
  не с фичи, а с переиспользуемых ограждений, на которые встанут 11c (AI-ответ по триггерам)
  и 11d (модерация). Видимой фичи в 11b нет; поведение генерации постов НЕ изменилось.
  - РОУТИНГ МОДЕЛЕЙ (`services/ai/aiGenerationService.ts`): рядом с `GENERATION_MODEL`
    (`claude-opus-4-8`, дорогая — только генерация постов) добавлен `CLASSIFY_MODEL`
    (`claude-haiku-4-5`, дешёвая — короткие ответы/классификация/модерация; для 11c/11e).
    Политика из `План.txt` («Защита API»): дорогая модель только для генерации/сложной
    аналитики, всё остальное — дешёвая.
  - ТАЙМАУТ на вызов Claude (то, что просил владелец: «таймаут должен быть и здесь»):
    `createAnthropicClient(apiKey, options?)` обобщён — `{ model, maxTokens, timeoutMs,
    jsonSchema }` с дефолтами = прежнее поведение (Opus, 1024, JSON-схема черновика), поэтому
    `generatePostDraft` не изменился. Таймаут передаётся вторым аргументом SDK
    `messages.create(body, { timeout })`; дефолт `DEFAULT_AI_TIMEOUT_MS=15000`. `jsonSchema:
    null` → без `output_config` (чистый текст, понадобится для ответов 11c). Env
    `AI_TIMEOUT_MS` (опц., zod) протянут: `index.ts` → `BotDeps`/`AdminDeps`/`ApprovalDeps`/
    `PostingDeps`/`AiGenerationDeps` (везде `timeoutMs?`, мягко — нет значения → дефолт).
  - ДНЕВНОЙ БЮДЖЕТ на канал (переиспользуемое ограждение): ЧИСТОЕ ядро
    `core/ai/dailyBudget.ts` `consumeDailyBudget(state, cap, today)` → `{allowed, state}`
    (сброс при смене даты; `cap<=0` или `count>=cap` → запрет; иначе +1) — под тестами.
    СЕРВИС `services/ai/aiBudget.ts` `tryConsumeDailyBudget(prisma, channelId, today)`:
    поверх `Setting` (`ai_budget_usage` JSON `{date,count}` + `ai_daily_cap` JSON number,
    дефолт 50); запись только при разрешении. `today` — дата в TZ канала, даёт вызывающий.
  - ПЕР-ЮЗЕР РЕЙТ-ЛИМИТ отдельного кода не потребовал: 11c возьмёт готовый
    `loadCooldown/saveCooldown` с синтетическим ключом `__ai_reply` (зафиксировано в доках).
  Проверки зелёные: typecheck 0, lint 0, vitest **214/214** (+6 `dailyBudget`: сброс на новый
    день, потолок, cap 0/отрицательный, инкремент). Правка `exactOptionalPropertyTypes`: все
    протянутые `timeoutMs?: number | undefined` (стиль репозитория). Миграций/зависимостей нет
    (`Setting` уже есть). Env-переменная опциональна.
  ⏭ Дальше — 11c (AI-ответ по триггерам: `core/ai/buildReplyPrompt` + `containsTrigger` +
    `aiReplyService` на Haiku + вживление `aiReplyStage` за тумблером `ai_reply_enabled`,
    с кулдауном `__ai_reply` и дневным бюджетом), затем 11d (эвристический антиспам).
- Шаг 11c: AI-ответ по триггер-словам в комментах голосом канала — видимая фича на
  ограждениях 11b. Бот ловит слово из ОТДЕЛЬНОГО набора AI-триггеров и отвечает коротким
  текстом в тоне канала дешёвой моделью (Haiku), под тройной защитой от расхода. Пул готовых
  текстов (`triggerStage`) не тронут; миграций/зависимостей нет — всё в `Setting`.
  - ХРАНЕНИЕ (`services/ai/aiReplySettings.ts`): `ai_reply_enabled` (boolean, дефолт **ВЫКЛ**)
    + `ai_trigger_words` (JSON `string[]`, отдельный набор). Дневной потолок — существующий
    `ai_daily_cap` (11b), добавлен сеттер `setDailyCap` в `services/ai/aiBudget.ts`
    (пер-канальный, SaaS: у каждого канала свой лимит; дефолт 50).
  - ЧИСТОЕ ЯДРО (под тестами): `core/triggers/containsTrigger.ts` — «сообщение СОДЕРЖИТ
    слово» (в отличие от `matchTrigger` = равенство всего сообщения), та же нормализация
    `normalizeTriggerText`, границы слова через обрамление пробелами (`кот ⊄ который`),
    возвращает первое совпавшее слово. `core/ai/buildReplyPrompt.ts` — билдер system/user
    из `{channelTitle,niche,toneOfVoice,language}`+коммент + zod-парсер `parseReplyText`
    (trim, непустой, лимит `MAX_REPLY_LENGTH=600`, иначе null — мягкая деградация).
  - СЕРВИС `services/ai/aiReplyService.ts` `generateReply(deps,input,client?)`: билдер →
    `createAnthropicClient(key,{model:CLASSIFY_MODEL,jsonSchema:null,timeoutMs})` → текст|null.
    Обрезка длинного коммента (500 симв.), нет ключа/ошибка/пустой ответ → null (не падает),
    клиент инъектируется в тестах (как `generatePostDraft`).
  - ВЖИВЛЕНИЕ `aiReplyStage` (была заглушка `"pass"`): ворота от дешёвых к дорогим —
    не бот/аноним → резолв канала → `ai_reply_enabled` → `containsTrigger` по AI-набору →
    ленивый фетч полей канала (`getReplyChannelById`) → пер-юзер кулдаун (`__ai_reply`, час
    из общей настройки канала) → `tryConsumeDailyBudget` (дата дня в TZ канала) → `generateReply`
    → ответ в тред. Бюджет списываем ДО вызова (жёсткая защита), кулдаун ставим ТОЛЬКО при
    реальном ответе. Любой отказ → `"pass"` (молчим). Роутинг коммента→канал вынесен из
    `triggerStage` в общий `comments/routing.ts` (`resolveCommentChannel`) — обе стадии
    резолвят одинаково, без дублирования. `CommentDeps` расширен `anthropicApiKey?`/`timeoutMs?`
    (уже течёт из `BotDeps`, проводка не нужна).
  - МЕНЮ: новый экран «🤖 AI-ответы в комментах» (`renderEngagement`, callback `eng`) из
    «⚙️ Настройки» (строка-заглушка «скоро» заменена): тумблер `engtgl`, дневной лимит `aicap`
    (pending `setAiCap` + `validateDailyCap` 0…1000), список AI-триггеров с пагинацией +
    добавить `aiaddw` (pending `addAiTrigger`, `validateTriggerWord` против AI-набора) /
    удалить `aidelw`. Паттерн `encodeCb`/pending — как у CRUD триггеров.
  Проверки зелёные: typecheck 0, lint 0, vitest **232/232** (+16 `aiReply`: containsTrigger,
    buildReplyPrompt/parseReplyText, generateReply с фейковым клиентом; +2 `validateDailyCap`).
  Решения владельца: AI-кулдаун ОБЩИЙ с триггерами (тот же час, отдельный ключ учёта);
    `ai_daily_cap` пер-канальный (SaaS), дефолт 50 — стартовое значение нового канала.
  ⚠️ Прод: фича заработает только с `ANTHROPIC_API_KEY` на Railway И при ВКЛ тумблере
    `ai_reply_enabled` + непустом `ai_trigger_words`. По умолчанию молчит (расход = 0).
  ⏳ Ручная проверка в Telegram (за пользователем): добавить AI-триггер, включить тумблер,
    написать коммент со словом → бот отвечает голосом канала; повтор в пределах кулдауна →
    молчит; при лимите 0 → молчит. ⏭ Дальше — 11d (эвристический антиспам, 0 токенов).

- Шаг 11d: модерация комментов ДЕШЁВЫМИ ЭВРИСТИКАМИ — без AI и без токенов. Наполнена
  заглушка `moderationStage` (стоит ПЕРВОЙ в конвейере: отсекает мусор до триггеров/AI, в т.ч.
  чтобы AI-стадия не тратила токены на ответ спамеру). Миграций/зависимостей нет — всё в `Setting`.
  - ХРАНЕНИЕ (`services/moderation/moderationSettings.ts`, калька `aiReplySettings`):
    `moderation_enabled` (bool, дефолт **ВЫКЛ**) + `moderation_delete` (bool, дефолт **ВЫКЛ** —
    авто-удаление, нужны права бота) + `moderation_stopwords` (JSON `string[]`). Геттеры/тумблеры/
    add-remove (идемпотентно, zod-парсинг JSON → `[]` при кривом).
  - ЧИСТОЕ ЯДРО (под тестами, +15): `core/moderation/detectSpam.ts` —
    `{ text, isPrivileged, stopWords? } → { spam:false } | { spam:true, reason }`, где
    `reason ∈ link|mentions|repeat|stopword` (приоритет = порядок). Привилегированный (админ/канал)
    → всегда не спам. Эвристики: `link` (регэкспы `https?://`/`www.`/`t.me/`/голый домен по частым
    зонам), `mentions` (`≥ MENTION_THRESHOLD=3` @-упоминаний), `repeat` (серия `≥ REPEAT_RUN_THRESHOLD=4`
    одинаковых символов — по СЫРОМУ тексту, т.к. `normalizeTriggerText` повторы схлопывает),
    `stopword` (через `containsTrigger` — нормализация обеих сторон, бонусом ловит «казинооо»→«казино»).
    Экспорт `SpamCategory = clean|spam|borderline` — `borderline` пока не выдаётся, хук под **11e**.
  - ВЖИВЛЕНИЕ `moderationStage` (была заглушка `"pass"`): гард текста → `resolveCommentChannel`
    (общий с 11c) → тумблер `moderation_enabled` → `isPrivileged = is_bot(аноним/канал) || adminId`
    → `getStopWords` → `detectSpam`. Спам: если `moderation_delete` — `ctx.deleteMessage()` в
    try/catch на `GrammyError` (нет прав → warn-лог + `false`, мягкая деградация); сигнал админу
    ВСЕГДА (`ctx.api.sendMessage(adminId)` с Markdown-fallback как `sendToAdmin`: причина + автор +
    действие + ссылка `t.me/c/<id без -100>/<msgId>` + фрагмент 200 симв.). Возврат: `handled`
    ТОЛЬКО при реальном удалении (стоп-конвейер), иначе `pass` (нормальные комменты идут дальше).
    `CommentDeps` расширен `adminId: number` (уже течёт из `BotDeps`, проводка не нужна).
  - МЕНЮ: новый экран «🛡 Модерация» (`renderModeration`, callback `mod`) из «⚙️ Настройки»
    (добавлена кнопка со статусом): тумблер `modtgl`, тумблер авто-удаления `moddel`, список
    стоп-слов с пагинацией (`PAGE_STOP_WORDS=8`) + добавить `modaddw` (pending `addStopWord`,
    `validateTriggerWord` против списка) / удалить `moddelw`. Экран-приглашение
    `renderAddStopWordPrompt`. Паттерн `encodeCb`/pending — как AI-триггеры 11c.
  Проверки зелёные: typecheck 0, lint 0, vitest **247/247** (+15 `moderation`: каждая эвристика,
    чистый текст, привилегированный со спам-текстом, пустой список стоп-слов), build ок.
  Решения владельца: действие — НАСТРОЙКА (сигнал по умолчанию — прав не требует, безопасно;
    авто-удаление — отдельным тумблером, мягкая деградация без прав); модерация первой в конвейере.
  ⚠️ Прод: фича молчит, пока не ВКЛ тумблер. Ручная проверка (за пользователем): ВКЛ модерацию →
    коммент со ссылкой от не-админа → сигнал админу; ВКЛ «удалять спам» при правах → удаление;
    без прав → только сигнал. ⏭ Дальше — 11e (токсичность через Haiku, встраивается в хук `borderline`).

- Шаг 11e: СЕМАНТИЧЕСКАЯ модерация токсичности через Haiku — второй слой `moderationStage`
  после дешёвых эвристик 11d (встал в зарезервированный хук `borderline`). Эвристики слепы к
  смыслу: враждебный коммент без ссылок/стоп-слов («автор — шарлатанка, разводит на деньги»)
  регэкспам «чистый»; 11e классифицирует токсичность в контексте ниши канала. Платная фича под
  теми же ограждениями, что 11b/11c. Миграций/зависимостей нет — всё в `Setting`.
  - НИШЕ-АГНОСТИЧНОСТЬ (SaaS): классификатор читает `niche/toneOfVoice/language` канала (как
    `buildReplyPrompt` в 11c) — один код судит токсичность для любой ниши, без хардкода. Владелец
    любого канала может дописать своё правило (`policy`) или оставить авто-оценку по нише.
  - ХРАНЕНИЕ (`services/moderation/moderationSettings.ts`, расширен): `moderation_toxicity_enabled`
    (bool, дефолт **ВЫКЛ**, ОТДЕЛЬНЫЙ тумблер от эвристик) + `moderation_toxicity_policy`
    (JSON string, пусто = авто). Действие переиспользует `moderation_delete` (11d); дневной бюджет
    ОБЩИЙ с AI-ответами (`ai_daily_cap`/`tryConsumeDailyBudget`) — так и задумано в 11b.
  - ЧИСТОЕ ЯДРО (под тестами, +13 к `moderation`): `core/moderation/buildToxicityPrompt.ts` —
    билдер system/user из полей канала + опц. `policy` (строка «Дополнительно для этого канала
    считать токсичным: …» добавляется только когда задана); `TOXICITY_JSON_SCHEMA` (Structured
    Outputs, как `DRAFT_JSON_SCHEMA`); `parseToxicityVerdict` (JSON.parse + zod `{toxic,reason}`,
    кривой → null); пред-фильтр `shouldCheckToxicity` (нормализованная длина ≥3 — 0 токенов на
    эмодзи/односимвольные, короткие оскорбления проходят).
  - СЕРВИС `services/moderation/toxicityService.ts` `classifyToxicity(deps,input,client?)`: точная
    калька `aiReplyService` — `createAnthropicClient(key,{model:CLASSIFY_MODEL,jsonSchema:
    TOXICITY_JSON_SCHEMA,timeoutMs})`, обрезка коммента 500, нет ключа/ошибка/кривой JSON → null
    (мягкая деградация: стадия трактует как «не токсично»). Клиент инъектируется в тестах.
  - ВЖИВЛЕНИЕ в `moderationStage`: действие спам- и токсичного слоёв вынесено в ОБЩИЙ хелпер
    `enforce(ctx,deps,channelId,reasonLabel)` (читает `moderation_delete` → `tryDelete` →
    `notifyAdmin` всегда → `handled` при удалении иначе `pass`); `notifyAdmin` обобщён на
    `reasonLabel: string`. Токсичный слой `checkToxicity` зовётся ПОСЛЕ `detectSpam`=не-спам,
    ворота дёшево→дорого (как `aiReplyStage`): не привилегированный → тумблер токсичности →
    `shouldCheckToxicity` → `getReplyChannelById` (ленивый фетч ниши/тона/языка/TZ) →
    `tryConsumeDailyBudget` (дата дня в TZ канала, списываем ДО вызова) → `getToxicityPolicy` →
    `classifyToxicity` → toxic → `enforce("токсичность: {reason}")`. `CommentDeps` НЕ менялся
    (`anthropicApiKey`/`timeoutMs` с 11c, `adminId` с 11d).
  - МЕНЮ: экран «🛡 Модерация» дополнен тумблером `🧠 Токсичность (AI)` (`toxtgl`, образец `modtgl`)
    и `📝 Политика: авто/своя` (`toxpol` → pending `setToxicityPolicy`; в `handleInput` «-»/пусто →
    сброс `setToxicityPolicy("")`, иначе сохранить ≤500 симв.). Экран-приглашение
    `renderSetToxicityPolicyPrompt`. Заметка «тратит токены (Haiku), лимит общий с AI-ответами».
  Проверки зелёные: typecheck 0, lint 0, vitest **260/260** (moderation 28: +buildToxicityPrompt
    ниша/политика, parseToxicityVerdict валид/битый/неполный, shouldCheckToxicity, classifyToxicity
    с фейк-клиентом toxic/clean/нет-ключа/ошибка/кривой), build ок.
  Решения владельца: охват — враждебность к каналу/автору/аудитории, но per-channel по нише (SaaS);
    настраиваемость — авто + свободное поле политики; действие — отдельный тумблер, дефолт сигнал;
    бюджет — общий с AI-ответами.
  ⚠️ Прод (как 11c/11d): `ANTHROPIC_API_KEY` на Railway + ВКЛ модерацию + ВКЛ токсичность →
    враждебный коммент без ссылок/стоп-слов от не-админа → сигнал админу с причиной; своя политика
    влияет; при исчерпанном бюджете Haiku не зовётся (расход 0); ВКЛ `moderation_delete` при правах →
    удаление. ⏭ Engagement Engine закрыт (эвристика 11d + AI-токсичность 11e); кандидат 11f —
    авто-связка «слово в CTA поста ↔ AI-триггер».

- Шаг 11f: АВТО-РЕГИСТРАЦИЯ AI-триггера из CTA опубликованного поста — закрывает UX-нюанс 11c.
  Раньше AI-триггеры (`ai_trigger_words`) заводились ВРУЧНУЮ и не были связаны с постом: владелец
  публиковал «напишите СЛОВО в комментах», а бот молчал, пока слово не добавишь руками в меню. Теперь
  публикация поста САМА включает AI-ответ на призывное слово. 0 токенов, миграций/зависимостей нет.
  - Развилки (согласовано с владельцем): ОТКУДА — эвристика по CTA (0 токенов, работает и для ручного,
    и для AI-поста); КУДА — только `ai_trigger_words` (пул готовых текстов не трогаем); КОГДА —
    при ПУБЛИКАЦИИ (триггер активен ровно к моменту, когда подписчики видят CTA); снятие «отжившего»
    триггера — НЕ делаем (только добавляем, идемпотентно), в `docs/BACKLOG.md`.
  - ЧИСТОЕ ЯДРО (под тестами, +8 к `triggers`): `core/triggers/extractTriggerFromCta.ts` —
    `extractTriggerFromCta(cta) → string | null`. Эвристика по приоритету: (1) слово/короткая фраза
    в кавычках («…»/"…"/„…“) — намеренный маркер; (2) слово КАПСОМ (≥3 буквы, целиком в верхнем
    регистре). Валидация кандидата по `normalizeTriggerText`: длина 3…40, ≤3 слов. Кавычки в
    приоритете над КАПСОМ (однозначнее — КАПС может поймать аббревиатуру). Ничего не подошло → null.
  - ВЖИВЛЕНИЕ в `services/postingService.ts`: хелпер `registerCtaTrigger(deps,channelId,cta)` —
    `extractTriggerFromCta` → `validateTriggerWord` (отсекает нормализованные дубли) → `addAiTriggerWord`
    (11c, идемпотентно). Свои ошибки глотает (лог warn) — регистрация НЕ роняет публикацию. Зовётся
    во ВСЕХ точках выхода поста в канал: прямой автопостинг планового поста, AI-подхват (10c),
    разовый пост (6c), публикация одобренного поста (`publishPending`). Превью админу (одобрение/
    предпросмотр) триггер НЕ регистрируют — только реальная публикация.
  - Переиспользовано (не писали заново): `addAiTriggerWord`/`getAiTriggerWords` (11c, идемпотентны),
    `validateTriggerWord` (нормализованный дедуп), `normalizeTriggerText` (ядро 11c/Шаг 2).
  Проверки зелёные: typecheck 0, lint 0, vitest **268/268** (triggers 26: +КАПС, +кавычки типогр./
    прямые, +короткая фраза, +приоритет кавычек, +отсев мусора/коротких/длинных, +латиница), build ок.
  ⚠️ Прод: работает автоматически при публикации любого поста с призывным словом КАПСОМ/в кавычках в
    CTA. Чтобы бот РЕАЛЬНО ответил — как в 11c: `ANTHROPIC_API_KEY` на Railway + ВКЛ тумблер AI-ответов
    + бюджет не исчерпан. Без этого триггер зарегистрируется, но ответа не будет (расход 0).
  ⏭ В бэклоге (`docs/BACKLOG.md`): сбор идей из обсуждений; снятие устаревшего триггера; проверка
    «админ группы» в модерации; 11c-fix (ответы анонимам).

- Шаг 12a: ЯДРО Content Intelligence (Шаг 12, «AI-директор канала», Модуль 1/2) — ЧИСТАЯ логика
  превращения сырых метрик постов в структурные выводы. Первый подшаг эпика 12 (план
  `.claude/plans/12-content-nifty-river.md`). Ни Telegram, ни БД, ни AI — только математика под
  тестами, задаёт «словарь метрик» для 12b (сбор/сервис) и 12c (отчёт/экран «📈 Рост»). 0 токенов,
  0 миграций, 0 внешних сервисов.
  - Зачем: еженедельный отчёт 7c даёт список сырых чисел без выводов. Владелец не понимает, что зашло,
    когда публиковать и растёт ли охват. 12a — фундамент, который это считает.
  - НОВЫЕ МОДУЛИ `src/core/analytics/` (+21 тест, `tests/contentIntelligence.test.ts`):
    · `engagement.ts` — `engagementRate` = (реакции+комменты)/просмотры, доля 0..1; просмотры ≤0 → 0
      (безопасное деление). ERR важнее сырых просмотров при 400 подписчиках.
    · `dimensions.ts` — `timeDimensions(postedAt, tz)` → {hour, weekday, slot}. Слот утро/вечер по
      местному часу канала, порог `MIDDAY_HOUR=15`. Переиспользует `localDateParts` (core/schedule).
      Контентные признаки (медиа/кнопки/длина) придут с данными 12b.
    · `outliers.ts` — фильтр качества (риск №5): `median` + `flagViewOutliers` (просмотры ≥ `factor`×
      медианы = виральный/рекламный залёт). `DEFAULT_OUTLIER_FACTOR=3`, `MIN_SAMPLE_FOR_OUTLIERS=4`
      (мало данных → ничего не метим). Сравниваем с медианой, а не средним (среднее сам выброс тащит).
    · `bestTime.ts` — `rankPostingTimes(posts, tz, outlier?)`: средний ERR по ячейке день×слот,
      отсортировано по убыванию (лучшее время — первым). Слот (не час) — устойчивая гранулярность при
      малой выборке. Выбросы исключаются из статистики.
    · `trend.ts` — `periodStat` (средние по окну) + `compareTrend(current, previous)`: Δ% просмотров/ERR
      неделя-к-неделе. Направление up/down/flat с зоной стабильности `FLAT_THRESHOLD_PCT=5`. Пустое
      прошлое окно → дельта null, flat (нет базы для %).
    · `insights.ts` — `buildInsights(current, previous, tz)` → `Insights` {count, best/worst по ERR,
      bestTimes, trend, outliers}. Верх ядра: детектит выбросы, исключает их из лучший/худший и из
      времени, но отдаёт отдельным списком. Только факты — форматирование в 12c, AI-нарратив в 12d.
  - Решения (из плана, согласовано): своя история + нативная стата Telegram для времени (нативное — 12b);
    лёгкая таблица истории для тренда (12b, миграция); вывод И в отчёт, И в экран «📈 Рост» (12c);
    советник сначала эвристиками (12c), AI — 12d; Telemetr (12e) за адаптером `MarketDataProvider` с
    мягкой деградацией — платный сервис НИКОГДА не фундамент (риск №4), свой канал живёт на MTProto даром.
  Проверки зелёные: typecheck 0, lint 0, vitest **289/289** (+21), build ок.
  ⏭ Дальше — 12b: миграция (поля медиа/кнопки/длина на PostMetric + таблица `ChannelStatSnapshot`) +
    обогащение MTProto-сбора + чтение `stats.getBroadcastStats` + сервис `contentIntelligenceService`.

- Шаг 12b: ДАННЫЕ И СБОР для Content Intelligence — наполняет ядро 12a реальными данными.
  Второй подшаг эпика 12. Схема (миграция) + обогащение MTProto-сбора + сервис + джоб снимка.
  - СХЕМА (миграция `20260711172515_step12b_content_dimensions_snapshot`):
    · `PostMetric` += `hasMedia`/`hasButtons` (Boolean, дефолт false) + `charLen` (Int, дефолт 0) —
      контентные измерения «что заходит», которых нет в сыром снимке 7c. Дефолты бэкфилят старые строки.
    · Новая таблица `ChannelStatSnapshot` (channelId, capturedAt, subscribers?, postCount7d, avgViews7d,
      avgErr7d) — периодические снимки агрегатов для тренда охвата (сравнение во времени без пересчёта
      по всем сырым метрикам). `avgErr7d` — Float (доля 0..1). Индекс `[channelId, capturedAt]`.
  - ЯДРО (`core/analytics/weeklyReport.ts`): `PostMetricInput` += `hasMedia`/`hasButtons`/`charLen`;
    `RawMessageLike` += `replyMarkup?`; `messageToMetric` считает их (`media`/`replyMarkup` → boolean,
    `charLen` = ПОЛНАЯ длина текста, не обрезанное превью). +4 теста (медиа без подписи, reply_markup,
    charLen по полному тексту), обновлён exact-match тест.
  - СБОР (`services/analytics/mtprotoClient.ts`): окно чтения 30 → **100** сообщений (для тренда нужны
    два окна по 7 дней). `messageToMetric` теперь тянет медиа/кнопки автоматически (GramJS `msg.media`/
    `msg.replyMarkup` структурно совпадают с `RawMessageLike`). Новая `fetchSubscriberCount` через
    `channels.getFullChannel` → `fullChat.participantsCount` (сужение `"participantsCount" in fullChat`,
    т.к. поле только у `ChannelFull`); любая ошибка → null (мягкая деградация, снимок всё равно ляжет).
  - НАТИВНАЯ СТАТА (`stats.getBroadcastStats`, лучшие часы Telegram) — СОЗНАТЕЛЬНО вынесена в **12b-2**,
    чтобы не раздувать подшаг (план прямо разрешил). Подписчики берём дешёвым `getFullChannel`.
  - РЕПОЗИТОРИИ: `postMetricRepository` — `upsertPostMetric` пишет новые поля; новая `listPostMetricsSince`
    (читает снимки канала с даты → `PostMetricInput[]`, сорт по дате). Новый
    `channelStatSnapshotRepository` — `createStatSnapshot` (append-only) + `getLatestStatSnapshot`.
  - СЕРВИС `services/analytics/contentIntelligenceService.ts` (две роли):
    · `buildChannelIntelligence(prisma, channelId, tz, now?)` — ЧИТАЕТ из БД (`PostMetric` +
      `ChannelStatSnapshot`), делит два окна по 7д, строит `Insights` ядра 12a + отдаёт последний снимок.
      0 токенов, без MTProto — это то, что 12c покажет владельцу.
    · `runStatSnapshot(deps)` — ДЖОБ: динамич. импорт GramJS, свежий сбор метрик (upsert) + подписчики +
      агрегаты 7д (`periodStat`) → `createStatSnapshot`. `destroy()` в finally (как отчёт 7c). Без MTProto/
      канала — тихо. Ошибки логируются, планировщик не роняется.
  - ДЖОБ (`scheduler/analytics.ts`): третий крон — снимок охвата ежедневно **22:00 МСК** (`protect:true`).
    Изоляция сохранена: GramJS только динамическим импортом внутри `runStatSnapshot`.
  - Проверки зелёные: typecheck 0, lint 0, vitest **291/291** (+2 нетто), build ок. Миграция применена
    локально (`prisma migrate dev`).
  - ⚠️ Прод: миграцию на Railway применит `prisma migrate deploy` (в `npm start`). Снимок реально пишется
    только при настроенном MTProto (`TELEGRAM_API_ID/HASH/SESSION`) — иначе джоб тихо ничего не делает.
  ⏭ Дальше — 12b-2 (нативная стата `stats.getBroadcastStats`: лучшие часы Telegram) либо сразу 12c
    (отчёт/экран «📈 Рост» поверх `buildChannelIntelligence`).

- Шаг 12b-2: НАТИВНАЯ СТАТА Telegram — лучшие часы канала из `stats.getBroadcastStats`. Хвост 12b,
  который сознательно откладывали, чтобы не раздувать основной подшаг. Дополняет наш ERR-подбор
  времени (`bestTime.ts`, мало данных при 400 подписчиках) нативным графиком по всей истории охвата.
  - ЯДРО (`core/analytics/topHours.ts`, +9 тестов `tests/topHours.test.ts`): ЧИСТЫЙ парсер строки
    `DataJSON.data` графа `topHoursGraph` (формат графиков Telegram `{"columns":[["x",0..23],["y0",…]]}`)
    → `TopHour[]` {hour 0..23, value}. `parseTopHoursGraph` (натуральный порядок) + `rankTopHours`
    (best-first, тай-брейк по часу). Битый JSON / нет колонок / час вне 0..23 / нечисло → пропуск/[].
  - СБОР (`services/analytics/mtprotoClient.ts`): `fetchTopHours(client, target)` — изолированный
    MTProto-хелпер. `fetchBroadcastStats` обрабатывает `STATS_MIGRATE_X` (стата живёт на профильном DC —
    переспрашиваем на нём через `client.invoke(req, dcId)`); `resolveGraphData` тянет данные из готового
    `StatsGraph.json.data` или догружает `StatsGraphAsync` по токену (`stats.loadAsyncGraph` на том же DC);
    `StatsGraphError`/любая ошибка → `[]` (мягкая деградация, как `fetchSubscriberCount`).
  - ХРАНЕНИЕ: миграция `..._step12b2_snapshot_top_hours` — `ChannelStatSnapshot.topHours Json?` (nullable
    JSONB). Репозиторий пишет ВСЕГДА массив (в т.ч. пустой) → обходит грабли Prisma DbNull/JsonNull;
    `[...topHours] as unknown as Prisma.InputJsonValue` (интерфейс без индекс-сигнатуры Prisma напрямую
    не пускает). Чтение — мягкий `toTopHours` (не массив/битые элементы → []). `StatSnapshotInput`/`Row`
    += `topHours`.
  - ВЖИВЛЕНИЕ: `runStatSnapshot` (тот же джоб ежедневно 22:00 МСК) теперь после подписчиков зовёт
    `fetchTopHours` и кладёт результат в снимок. `buildChannelIntelligence` уже отдаёт `latestSnapshot` —
    значит 12c получит нативные часы бесплатно.
  - Проверки зелёные: typecheck 0, lint 0, vitest **300/300** (+9), build ок. Миграция применена локально.
  - ⚠️ Прод: нужны права админа канала у аккаунта MTProto (иначе `stats.getBroadcastStats` откажет →
    пустые часы, снимок всё равно ляжет). Стата появляется у канала не сразу (нужен минимум охвата).
  ⏭ Дальше — 12c: отчёт/экран «📈 Рост» поверх `buildChannelIntelligence` (свои слоты + нативные часы,
    тренд охвата по снимкам, эвристический советник; AI-нарратив — 12d).

- Шаг 12c: ВЫВОД Content Intelligence — впервые ПОКАЗЫВАЕТ владельцу выводы (отчёт + экран «📈 Рост»).
  Третий подшаг эпика 12. Ядро 12a считает, 12b/12b-2 наполняют данными — 12c форматирует и выводит.
  0 токенов, 0 миграций (всё из готовых таблиц `PostMetric`/`ChannelStatSnapshot`). Сделан ЦЕЛИКОМ (и
  ядро+сервис+секция отчёта, и отдельный экран меню) — скоуп не пришлось резать по шву 12c-1/12c-2.
  - ЯДРО — контентные измерения (`core/analytics/dimensions.ts`, +2 теста): `contentDimensionStats`
    (средний ERR по hasMedia/hasButtons + бакеты длины) + `lengthBucket` (`CHAR_LEN_SHORT_MAX=200`,
    `CHAR_LEN_LONG_MIN=600`). Чистая группировка, пустая группа → {count:0, avgErr:0}. Вынес рядом с
    временными измерениями (`ContentDimensioned extends EngagementLike`, без импорта БД/weeklyReport).
  - ЯДРО — эвристический советник (`core/analytics/advisor.ts`, +5 тестов): `buildAdvice(insights,
    contentStats, snapshot)` → `Advice[]` (дискриминированный union kind+priority, ФАКТЫ без текста TG).
    Правила: лучший/худший слот по ERR; нативные часы Telegram (`SnapshotSummary.nativeTopHoursLocal`,
    совпал ли слот топ-часа с нашим → `matchesOwn`); тренд (viewsDirection + Δ подписчиков между снимками);
    контент (медиа/кнопки/длина — `compareTwo`/`bestLengthBucket`, порог `MIN_POSTS_PER_DIMENSION=2`);
    выбросы отдельной пометкой. Порог достаточности `MIN_POSTS_FOR_ADVICE=3` (мало постов → только
    `not_enough_data`). `snapshot` — ЧИСТЫЙ тип ядра `SnapshotSummary` (без типов БД, часы уже локальные).
  - ЯДРО — форматтер (`core/analytics/insightsReport.ts`, +2 теста): `buildInsightsReport(insights,
    advice, nativeTopHoursLocal)` → строки «что зашло / что провалилось / лучшее время (свои слоты +
    нативные часы Telegram) / рекомендации». Пусто → заглушка. ⚠️ БЕЗ Markdown-эмфазы (`*`/`_`): один
    текст идёт и в еженедельный отчёт (Markdown), и на экран (editMessageText БЕЗ parse_mode) — эмодзи+
    структура читаются одинаково; превью чистятся от `*`/`_`. Параметр `tz` НЕ нужен (пояс уже зашит:
    слоты считаны в 12a, нативные часы локализованы сервисом) — убран, чтобы не ловить no-unused-vars.
  - ЯДРО (`topHours.ts`): выделен `sortTopHours(readonly TopHour[])` (ранжирование уже разобранных часов);
    `rankTopHours(json)` теперь тонкая обёртка над ним. Нужен сервису для нативных часов из снимка.
  - РЕПОЗИТОРИЙ (`channelStatSnapshotRepository.ts`): `listRecentStatSnapshots(prisma, channelId, take)`
    (новейший первым) для Δ подписчиков между снимками; `getLatestStatSnapshot` стал обёрткой над ним.
  - СЕРВИС (`services/analytics/contentIntelligenceService.ts`): `buildChannelIntelligence` расширен —
    возвращает `contentStats` (по текущему окну) + два последних снимка (`latestSnapshot`/`previousSnapshot`).
    Новый `buildGrowthReport(prisma, channelId, tz, now?)` — БД-only поверх `buildChannelIntelligence` →
    `toSnapshotSummary` (нативные часы UTC→пояс канала через `utcHourToLocal`, Δ подписчиков) → `buildAdvice`
    → `buildInsightsReport`. 0 токенов, без MTProto.
  - ВЫВОД в двух местах (решение из плана «И в отчёт, И в экран»):
    · Еженедельный отчёт (`weeklyReportService.ts`): после сырых чисел 7c дописывается секция
      `buildGrowthReport` (через разделитель). Метрики только что записаны в БД → отчёт читает свежие данные.
    · Экран «📈 Рост» (`renderGrowth` + широкая кнопка `grow` в `MAIN_SECTIONS` + ветка роутера): паттерн
      как «📅 Календарь»/«📊 Аналитика». Тост «Считаю выводы… ⏳», затем `editScreen` (плейн-текст).
      Подсказка про MTProto: настроен → «обновляется автоматически», нет → «метрики не собираются».
  - Проверки зелёные: typecheck 0, lint 0, vitest **310/310** (+10), build ок. Миграций НЕТ (всё из
    готовых таблиц). Смоук-прогон пайплайна (buildInsights→buildAdvice→buildInsightsReport) — текст связный.
  - ⚠️ Прод: экран/секция работают всегда, но выводы скудны без данных — их наполняют джоб снимка (22:00
    МСК) и еженедельный отчёт (ПН 09:30 МСК), оба требуют настроенного MTProto + прав админа канала.
    Тренд по просмотрам берётся из `insights.trend` (12a) по всему окну, включая выбросы — на экстремальном
    выбросе % может скакнуть (на реальных данных не критично; при желании — исключение выбросов из тренда).
  ⏭ Дальше — 12d (AI-нарратив: тот же отчёт голосом канала через Haiku) либо 12e (Telemetr за адаптером
    `MarketDataProvider`). Автоперестановка расписания по выводам — отдельный будущий шаг.

- Шаг 12d: AI-НАРРАТИВ отчёта «Рост» голосом канала — опциональный стилистический слой поверх готовых
  фактов 12c через дешёвую Haiku. Четвёртый подшаг эпика 12. Никакой новой аналитики: LLM только
  ПЕРЕСКАЗЫВАЕТ уже посчитанное (принцип 11c/11e), фолбэк — эвристический текст 12c (расход 0). Сделан
  ЦЕЛИКОМ (оба места вывода, как 12c) — скоуп не пришлось резать по шву 12d-1/12d-2. Миграций НЕТ.
  - ЯДРО (`core/ai/buildGrowthNarrativePrompt.ts`, +6 тестов): билдер промпта по образцу
    `buildReplyPrompt` — тон канала (`title/niche/toneOfVoice/language`, niche-agnostic по данным) +
    ГОТОВЫЙ текст `buildInsightsReport` как источник фактов; system жёстко запрещает выдумывать
    («ТОЛЬКО факты и числа из отчёта»), просит сохранить конкретику (дни/часы/проценты) и 6–10 строк.
    `parseNarrative` (zod, `MAX_NARRATIVE_LENGTH=1500`, кривой/пустой/длинный → null) дополнительно
    ВЫЧИЩАЕТ Markdown-эмфазу `*`/`_` — текст идёт и в Markdown-отчёт (сломал бы parse_mode), и на
    плейн-экран (правило 12c).
  - СЕРВИС (`services/ai/growthNarrativeService.ts`, +4 теста): `generateGrowthNarrative(deps, input,
    client?)` — калька `generateReply`: `CLASSIFY_MODEL` (Haiku), `jsonSchema: null`, обрезка фактов
    3000, нет ключа/ошибка/кривой ответ → null, клиент инъектируется в тестах. Оркестратор
    `narrateGrowthReport(deps, channelId, factsReport)` — ворота дёшево→дорого (как стадии 11c/11e):
    тумблер → ключ → `getReplyChannelById` (тон, ленивый фетч) → `tryConsumeDailyBudget` (ОБЩИЙ
    `ai_daily_cap`, дата в TZ канала, списываем ДО вызова) → Haiku; любой отказ → исходный текст 12c.
  - ХРАНЕНИЕ (без миграции, в `Setting`): `growth_narrative_enabled` (bool, дефолт **ВЫКЛ**, отдельный
    ключ) — `services/ai/growthNarrativeSettings.ts` по образцу `aiReplySettings` (get/toggle).
  - ВЖИВЛЕНИЕ в двух местах (решение как 12c — «И там, И там»):
    · Экран «📈 Рост» (`renderGrowth`): при ВКЛ тумблере факты оборачиваются в пересказ + приписка
      «тратит токены»; кнопка-тумблер `🧠 AI-пересказ: ВКЛ/ВЫКЛ` (callback `gntgl`) прямо на экране —
      включение сразу перерисовывает экран уже с пересказом (тост предупреждает про токены).
    · Еженедельный отчёт (`weeklyReportService`): секция роста 12c оборачивается `narrateGrowthReport`;
      `WeeklyReportDeps` += `anthropicApiKey?`/`timeoutMs?` (опц., мягко), прокинуты в обеих точках
      сборки deps — планировщик (`index.ts`) и тест-кнопка `anrep` в меню.
  - Проверки зелёные: typecheck 0, lint 0, vitest **320/320** (+10), build ок. Миграций НЕТ.
  - ⚠️ Прод: чтобы увидеть пересказ — как 11c/11e: `ANTHROPIC_API_KEY` на Railway + ВКЛ тумблер на
    экране «📈 Рост» + непустой дневной бюджет (`ai_daily_cap`, общий с AI-ответами/токсичностью).
    Без любого из этого — сухой эвристический текст 12c, расход 0. Один показ экрана/отчёта при ВКЛ
    тумблере = один вызов Haiku (каждое открытие экрана «📈 Рост» списывает единицу бюджета).
  - Ручная проверка (за пользователем): «📈 Рост» → кнопка «🧠 AI-пересказ» → ВКЛ → текст стал живым
    голосом канала (факты те же); выключить → вернулся сухой список. «📊 Аналитика → отчёт сейчас» при
    ВКЛ тумблере — секция роста в отчёте тоже пересказана.
  ⏭ Дальше — 12e (Telemetr за адаптером `MarketDataProvider`, мягкая деградация; перевыпустить
    засвеченный ключ Telemetr перед стартом). Автоперестановка расписания — отдельный будущий шаг.
