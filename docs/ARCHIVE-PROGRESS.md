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
🔜 Сейчас: Шаг 6c готов (разовый пост на дату-время через мастер). Дальше —
   AI-самообновление постов (Шаг 10). Мультиканальная аналитика (еженедельный отчёт) ОТЛОЖЕНА.
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
