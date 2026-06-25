import type { PhotoRef } from "./types.js";

/**
 * Приоритет источника фото (Шаг 6a). ЧИСТАЯ логика, порт `_resolve_photo`
 * Python-бота: решает, КАКОЕ фото использовать, не делая ни сети, ни I/O.
 *
 * Порядок (от «уже знаем» к «надо подобрать»):
 *   1. `photoUrl` — готовое фото: кэш превью, своё загруженное или перевыбранное
 *      (URL или Telegram file_id). Высший приоритет — это явный выбор/результат.
 *   2. `photoPath` — локальный файл из контент-плана.
 *   3. `pexelsQuery` — запрос: нужно сходить к провайдеру (сток/генерация).
 *   4. иначе — фото нет.
 *
 * Существование локального файла проверяет вызывающий (тут — без I/O); при
 * отсутствии файла отправка всё равно мягко откатится на текст.
 */

/** Что известно про фото поста (поля из БД + возможный кэш). */
export interface PhotoSources {
  readonly photoUrl?: string | null;
  readonly photoPath?: string | null;
  readonly pexelsQuery?: string | null;
}

/** Решение: фото уже известно / нужно дёрнуть провайдера / фото нет. */
export type PhotoPlan =
  | { readonly kind: "ready"; readonly ref: PhotoRef }
  | { readonly kind: "fetch"; readonly query: string }
  | { readonly kind: "none" };

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== "";
}

/** Выбирает источник фото по приоритету (без сети/I/O). */
export function planPhoto(sources: PhotoSources): PhotoPlan {
  if (present(sources.photoUrl)) {
    return { kind: "ready", ref: { kind: "url", url: sources.photoUrl } };
  }
  if (present(sources.photoPath)) {
    return { kind: "ready", ref: { kind: "path", path: sources.photoPath } };
  }
  if (present(sources.pexelsQuery)) {
    return { kind: "fetch", query: sources.pexelsQuery };
  }
  return { kind: "none" };
}
