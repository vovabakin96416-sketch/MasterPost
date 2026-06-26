/**
 * Конфиг MTProto (Шаг 7b) — ЧИСТЫЙ модуль без GramJS.
 *
 * Зачем отдельно от `mtprotoClient.ts`: меню показывает лишь *статус* (настроены ли
 * 3 переменные), и эта проверка не должна тянуть тяжёлый GramJS в импорт-граф
 * запущенного бота. GramJS живёт только в `mtprotoClient.ts`, который импортирует
 * скрипт генерации сессии (и позже джоб отчёта 7c), но не сам бот.
 */

/** Три значения для входа под личным аккаунтом (все опциональны, как `PEXELS_API_KEY`). */
export interface MtprotoConfig {
  apiId?: number | undefined;
  apiHash?: string | undefined;
  session?: string | undefined;
}

/** Полностью заданный конфиг — все три поля присутствуют и непустые (узкий тип для 7c). */
export interface FullMtprotoConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

/**
 * Настроен ли MTProto: заданы все три значения. Без них отчёт по просмотрам (7c)
 * просто отключён — бот работает как раньше (мягкая деградация, как у Pexels).
 */
export function isMtprotoConfigured(
  cfg: MtprotoConfig,
): cfg is FullMtprotoConfig {
  return (
    cfg.apiId !== undefined &&
    cfg.apiHash !== undefined &&
    cfg.apiHash !== "" &&
    cfg.session !== undefined &&
    cfg.session !== ""
  );
}
