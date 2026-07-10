/**
 * Дневной бюджет AI-вызовов на канал (Шаг 11b, защита от расхода токенов).
 *
 * ЧИСТАЯ логика без БД/сети — как `cooldown.ts`. Считает, можно ли сделать ещё один
 * платный AI-вызов сегодня, и возвращает НОВОЕ состояние счётчика. Ввод-вывод (чтение/
 * запись в `Setting`) — в сервисе `services/ai/aiBudget.ts`, чтобы это осталось под тестами.
 *
 * Дата — непрозрачная строка «YYYY-MM-DD» (сравнивается на равенство); её вычисляет
 * вызывающий в таймзоне канала. Смена даты сбрасывает счётчик.
 */

/** Состояние дневного счётчика: дата и число сделанных сегодня вызовов. */
export interface DailyBudgetState {
  date: string; // "YYYY-MM-DD"
  count: number;
}

/** Решение бюджета: разрешён ли вызов + состояние для сохранения. */
export interface DailyBudgetResult {
  allowed: boolean;
  state: DailyBudgetState;
}

/**
 * Пытается «списать» один вызов из дневного бюджета.
 * - `state` за другой день (или `null`) → счётчик начинается с 0 (сброс).
 * - `cap <= 0` → всё запрещено (полное отключение платных вызовов).
 * - `current >= cap` → запрещено, счётчик не растёт.
 * - иначе → разрешено, счётчик +1.
 *
 * При `allowed=false` возвращается состояние с сегодняшней датой (чтобы запись
 * «подтянулась» к текущему дню), но без инкремента.
 */
export function consumeDailyBudget(
  state: DailyBudgetState | null,
  cap: number,
  today: string,
): DailyBudgetResult {
  const current = state !== null && state.date === today ? state.count : 0;
  if (cap <= 0 || current >= cap) {
    return { allowed: false, state: { date: today, count: current } };
  }
  return { allowed: true, state: { date: today, count: current + 1 } };
}
