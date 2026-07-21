import type { InlineKeyboard } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import type { MtprotoConfig } from "../../../services/analytics/mtprotoConfig.js";
import type { InteractiveType } from "../../../db/repositories/postRepository.js";
import type { Button, Choice } from "../../../core/content/postSchema.js";

/**
 * Меню админа (Шаг 3) — изолированный Composer `adminMenu`. Порт `cmd_menu` /
 * `button_handler` Python-бота, но на TS, с данными в БД (Channel/TextPool/Setting)
 * и доступом только администратору (`adminId`).
 */

/**
 * Текущий пользователь меню (Шаг 14b-1, мультитенант). До 14b меню было закрыто
 * единственным `ADMIN_ID`; теперь его открывает любой зарегистрированный владелец
 * (строка в `Owner`), и все экраны работают ТОЛЬКО с его каналами.
 */
export interface MenuViewer {
  /** Telegram user id — ключ эфемерных состояний (pending/drafts/выбранный канал). */
  readonly userId: number;
  /** id строки `Owner` — скоуп каналов (`listChannelsByOwner`). */
  readonly ownerId: string;
}

/** Зависимости меню на старте бота: БД, логгер, id супервладельца, ключи API и статус MTProto. */
export interface AdminBotDeps {
  prisma: PrismaClient;
  logger: Logger;
  // Супервладелец (`ADMIN_ID`). После 14b-1 это НЕ гейт меню (гейт — таблица `Owner`),
  // а адресат превью одобрения и владелец служебных экранов («➕ Пригласить владельца»).
  // Разграничение одобрения по владельцу канала — 14b-2.
  adminId: number;
  pexelsApiKey: string | undefined;
  // Шаг 10b: ключ Anthropic для кнопки «🤖 AI-пост». undefined → генерация отключена
  // (тост-подсказка админу), как pexelsApiKey для фото.
  anthropicApiKey: string | undefined;
  // Шаг 11b: таймаут вызова Claude (мс); undefined → DEFAULT_AI_TIMEOUT_MS.
  timeoutMs?: number | undefined;
  // Шаг 12e: ключ Telemetr для секции «🌍 Рынок» на экране «📈 Рост».
  // undefined → секции просто нет (мягкая деградация, как pexelsApiKey).
  telemetrApiKey: string | undefined;
  // Шаг 14b-bis-1: свой бот клиента. `botTokenEncKey` — ключ шифрования токена в БД
  // (undefined → экран «🤖 Мой бот» честно говорит «не настроено», как без ключа
  // Pexels); `mainBotUserId` — id общего бота, его подключить себе нельзя (409).
  botTokenEncKey: string | undefined;
  mainBotUserId: string | undefined;
  // Шаг 7b: только для строки статуса в «📊 Аналитика». Это ЧИСТЫЙ конфиг (без GramJS) —
  // меню не тянет тяжёлый mtprotoClient в импорт-граф запущенного бота.
  mtproto: MtprotoConfig;
}

/**
 * Зависимости одного апдейта меню: то же + личность пользователя, прошедшего гейт.
 * Собираются композером на каждый апдейт (`{ ...deps, viewer }`) — рендереры экранов
 * и резолверы каналов читают `viewer`, не зная, откуда он взялся.
 */
export interface AdminDeps extends AdminBotDeps {
  viewer: MenuViewer;
}

/**
 * Готовый к отправке экран: текст + inline-клавиатура. Каждый рендерер экрана
 * возвращает эту пару — Telegram-слой одинаково шлёт новое сообщение или
 * редактирует существующее.
 */
export interface Screen {
  readonly text: string;
  readonly keyboard: InlineKeyboard;
}

/**
 * Режим ожидания текстового ввода (порт `ConversationHandler` Python-бота).
 * Состояние эфемерно (in-memory Map, теряется при рестарте) — приемлемо для
 * единичных операций одного админа; новой таблицы не заводим.
 */
export type PendingInput =
  | { readonly kind: "addTrigger" }
  | { readonly kind: "addAnswer"; readonly word: string }
  | { readonly kind: "editAnswer"; readonly word: string; readonly index: number }
  | { readonly kind: "addTime" }
  | { readonly kind: "setCooldown" }
  | { readonly kind: "setChannel" }
  | { readonly kind: "addChannel" }
  // Шаг 11c — Engagement: слово в набор AI-триггеров и дневной лимит AI-вызовов.
  | { readonly kind: "addAiTrigger" }
  | { readonly kind: "setAiCap" }
  // Шаг 11d — модерация: слово в список стоп-слов.
  | { readonly kind: "addStopWord" }
  // Шаг 11e — модерация: правило политики токсичности (свободный текст).
  | { readonly kind: "setToxicityPolicy" }
  // Шаг 12g — вет: ссылка/@username чужого канала для проверки перед закупкой рекламы.
  | { readonly kind: "vetChannel" }
  // Шаг 14b-1 — приглашение владельца (только супервладелец): Telegram user id + опц. имя.
  | { readonly kind: "inviteOwner" }
  // Шаг 14b-bis-1 — свой бот клиента: токен от @BotFather.
  | { readonly kind: "setBotToken" }
  | {
      readonly kind: "editPostField";
      readonly field: "title" | "text" | "cta";
      readonly externalId: number;
    }
  | { readonly kind: "addButtonAnswer"; readonly poolKey: string }
  | {
      readonly kind: "editButtonAnswer";
      readonly poolKey: string;
      readonly index: number;
    }
  // Шаг 6c — мастер «Новый пост» (разовая публикация по дате-времени). Сами данные
  // копятся в NewPostDraft; здесь — лишь маркер «какой ввод ждём на текущем шаге».
  | { readonly kind: "npTitle" }
  | { readonly kind: "npText" }
  | { readonly kind: "npCta" }
  | { readonly kind: "npChoice" } // ввод пары «метка | ответ» (цикл button_choice)
  | { readonly kind: "npBtnLabel"; readonly poolKey: string } // подпись кнопки-предсказания
  | { readonly kind: "npPexels" } // текстовый запрос для подбора фото
  | { readonly kind: "npPhotoUp" } // ждём присланное фото
  | { readonly kind: "npDateTime" }; // дата-время публикации

/**
 * Черновик разового поста, пока админ идёт по мастеру (Шаг 6c). Эфемерный (in-memory
 * Map, как PendingInput) — теряется при рестарте. Поля заполняются по шагам; на
 * сохранении превращается в NewOneOffPost репозитория.
 */
export interface NewPostDraft {
  title?: string;
  text?: string;
  cta?: string;
  interactiveType?: InteractiveType;
  choices: Choice[]; // button_choice — накопленные варианты
  button?: Button; // button_prediction — {type=ключ пула, label}
  pexelsQuery: string | null;
  photoFileId: string | null;
  publishAt?: Date;
}
