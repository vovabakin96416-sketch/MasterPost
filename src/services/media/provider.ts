import type { Logger } from "pino";

/**
 * Абстракция источника фото (Шаг 6a). Один интерфейс под обе версии продукта:
 * бесплатный сток (Pexels) и платную генерацию. `mediaService` выбирает провайдера
 * по тарифу канала и дёргает `fetch`. Новый источник = новая реализация этого
 * интерфейса, остальной код не меняется.
 */

/** Контекст вызова провайдера: логгер и ключ доступа (если нужен). */
export interface ProviderContext {
  readonly logger: Logger;
  readonly apiKey: string | undefined;
}

/** Провайдер фото: по текстовому запросу возвращает URL картинки или `null`. */
export interface MediaProvider {
  readonly name: string;
  /**
   * Возвращает URL подходящего фото по запросу, либо `null` — если источник
   * недоступен (нет ключа, ошибка сети, пустая выдача). `null` означает «без
   * фото» — вызывающий мягко откатывается на текст.
   */
  fetch(query: string, ctx: ProviderContext): Promise<string | null>;
}
