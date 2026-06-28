/**
 * Выбор «текущего» канала владельца для меню админа (Шаг 8a, мультиканальность).
 *
 * ЧИСТАЯ логика (без БД/Telegram): на вход — запомненный id и актуальный список
 * каналов, на выход — id канала, с которым работает меню. Правило:
 *   - запомненный выбор, если канал ещё есть в списке;
 *   - иначе первый канал (как делал рантайм до Шага 8 через `findFirst`);
 *   - иначе `null` (каналов нет — не запущен сид).
 */
export function pickSelectedId(
  selectedId: string | undefined,
  channels: readonly { id: string }[],
): string | null {
  if (selectedId !== undefined && channels.some((c) => c.id === selectedId)) {
    return selectedId;
  }
  return channels[0]?.id ?? null;
}
