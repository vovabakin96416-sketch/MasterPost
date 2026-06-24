/**
 * Пагинация длинных списков меню (триггеры, ответы).
 *
 * ЧИСТАЯ логика (без grammY/БД): на вход — массив и желаемая страница, на выход —
 * срез и флаги навигации. Страница нормализуется в допустимый диапазон, поэтому
 * битый/устаревший номер страницы из callback'а не выходит за границы.
 */

export interface Page<T> {
  /** Элементы текущей страницы. */
  readonly slice: T[];
  /** Фактическая (нормализованная) страница, 0-based. */
  readonly page: number;
  /** Всего страниц (минимум 1, даже для пустого списка). */
  readonly totalPages: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

/**
 * Возвращает страницу `page` (0-based) с размером `pageSize`. Пустой список →
 * одна пустая страница. Номер страницы зажимается в `[0, totalPages-1]`.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): Page<T> {
  const size = pageSize < 1 ? 1 : Math.floor(pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(Math.max(0, Math.floor(page)), totalPages - 1);
  const start = clamped * size;
  return {
    slice: items.slice(start, start + size),
    page: clamped,
    totalPages,
    hasPrev: clamped > 0,
    hasNext: clamped < totalPages - 1,
  };
}
