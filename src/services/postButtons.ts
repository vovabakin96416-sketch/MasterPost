import { InlineKeyboard } from "grammy";
import type { Button, Choice } from "../core/content/postSchema.js";
import type { InteractiveType } from "../db/repositories/postRepository.js";
import {
  encodeChoiceCb,
  encodePredictionCb,
} from "../core/buttons/callback.js";

/**
 * Построитель inline-клавиатуры поста (Шаг 6b) — порт ветки клавиатуры в
 * `send_post` Python-бота. Здесь живёт `InlineKeyboard` (как `approvalKeyboard`
 * в approvalService), а чистый протокол callback-data — в `core/buttons/callback`.
 *
 * Тематики нет: вид кнопок берётся из полей поста (`interactiveType`/`choices`/
 * `button`), код общий для любого канала.
 */

/** Поля поста, определяющие его кнопки. */
export interface PostButtonsInput {
  readonly channelId: string;
  readonly externalId: number;
  readonly interactiveType: InteractiveType;
  readonly choices: Choice[] | null;
  readonly button: Button | null;
}

/**
 * Клавиатура поста или `undefined`, если кнопок нет:
 * - `button_choice` + варианты → по строке-кнопке на вариант;
 * - `button_prediction` + кнопка → одна кнопка `button.label`;
 * - `keyword_trigger` / `vote_123` / нет данных → без клавиатуры (паритет с Python:
 *   `send_post` строит клавиатуру только для choice/prediction).
 */
export function buildPostKeyboard(input: PostButtonsInput): InlineKeyboard | undefined {
  const { channelId, externalId, interactiveType, choices, button } = input;

  if (interactiveType === "button_choice" && choices !== null && choices.length > 0) {
    const keyboard = new InlineKeyboard();
    choices.forEach((choice, idx) => {
      if (idx > 0) {
        keyboard.row(); // новая строка перед каждой кнопкой, кроме первой
      }
      keyboard.text(choice.label, encodeChoiceCb(channelId, externalId, idx));
    });
    return keyboard;
  }

  if (interactiveType === "button_prediction" && button !== null) {
    return new InlineKeyboard().text(
      button.label,
      encodePredictionCb(channelId, button.type),
    );
  }

  return undefined;
}
