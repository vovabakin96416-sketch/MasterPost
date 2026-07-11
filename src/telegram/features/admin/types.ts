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

/** Зависимости меню: БД, логгер, id админа, ключ Pexels (фото), ключ Anthropic (AI-пост) и статус MTProto. */
export interface AdminDeps {
  prisma: PrismaClient;
  logger: Logger;
  adminId: number;
  pexelsApiKey: string | undefined;
  // Шаг 10b: ключ Anthropic для кнопки «🤖 AI-пост». undefined → генерация отключена
  // (тост-подсказка админу), как pexelsApiKey для фото.
  anthropicApiKey: string | undefined;
  // Шаг 11b: таймаут вызова Claude (мс); undefined → DEFAULT_AI_TIMEOUT_MS.
  timeoutMs?: number | undefined;
  // Шаг 7b: только для строки статуса в «📊 Аналитика». Это ЧИСТЫЙ конфиг (без GramJS) —
  // меню не тянет тяжёлый mtprotoClient в импорт-граф запущенного бота.
  mtproto: MtprotoConfig;
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
