import type { InlineKeyboard } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../../../db/client.js";
import type { MtprotoConfig } from "../../../services/analytics/mtprotoConfig.js";

/**
 * Меню админа (Шаг 3) — изолированный Composer `adminMenu`. Порт `cmd_menu` /
 * `button_handler` Python-бота, но на TS, с данными в БД (Channel/TextPool/Setting)
 * и доступом только администратору (`adminId`).
 */

/** Зависимости меню: БД, логгер, id админа, ключ Pexels (фото) и статус MTProto. */
export interface AdminDeps {
  prisma: PrismaClient;
  logger: Logger;
  adminId: number;
  pexelsApiKey: string | undefined;
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
  | { readonly kind: "setChannel" }
  | { readonly kind: "addChannel" }
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
    };
