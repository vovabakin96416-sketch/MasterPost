/**
 * Текст превью одобрения (Шаг 5). ЧИСТАЯ логика (без grammY/БД): собирает подпись,
 * которую бот шлёт админу перед публикацией. Порт `_approval_caption` Python-бота.
 */

/** Снимок текстовых полей поста для превью одобрения (фото — Шаг 6). */
export interface PostSnapshot {
  readonly title: string;
  readonly text: string;
  readonly cta: string;
}

/**
 * Подпись превью: сам пост (`*title*` + текст + CTA) + куда он уйдёт. Если канал
 * публикации не задан — предупреждаем (опубликовать не выйдет, пока не укажут цель).
 */
export function buildApprovalCaption(
  snapshot: PostSnapshot,
  target: string | null,
): string {
  const body = `*${snapshot.title}*\n\n${snapshot.text}\n\n${snapshot.cta}`.trim();
  return `📋 *Одобри публикацию*\n\n${body}\n\nКанал: ${target ?? "не задан ⚠️"}`;
}
