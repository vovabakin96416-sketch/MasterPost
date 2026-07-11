/**
 * Разбор нативного графа «лучшие часы» Telegram (Шаг 12b-2) — ЧИСТАЯ логика (без GramJS).
 *
 * `stats.getBroadcastStats` отдаёт `topHoursGraph` — средняя активность по часам суток
 * (0..23) в формате графиков Telegram (`DataJSON.data` — строка JSON вида
 * `{"columns":[["x",0,1,…,23],["y0",v0,…,v23]], …}`). Здесь только парсинг строки в
 * структуру + ранжирование; сам вызов MTProto и загрузка async-графа живут в
 * `mtprotoClient.ts`, чтобы core не зависел от GramJS и тестировался в изоляции.
 *
 * Зачем рядом со «своими» `bestTime.ts`: наш подбор времени — по ERR наших постов
 * (мало данных при 400 подписчиках), нативный — по всей истории охвата Telegram. 12c
 * покажет оба; расходятся — повод задуматься, совпали — уверенный сигнал.
 */

/** Средняя активность канала в конкретный час суток (по нативной стате Telegram). */
export interface TopHour {
  readonly hour: number; // 0..23 (час суток в UTC, как отдаёт Telegram)
  readonly value: number; // средняя активность (просмотры/взаимодействия), у.е.
}

/** Час суток валиден только в диапазоне 0..23 (целое). */
function isHour(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 23;
}

/**
 * Парсит строку `DataJSON.data` графа лучших часов в `TopHour[]` в натуральном порядке
 * (как пришло). Берёт колонку `x` (часы) и первую колонку `y*` (значения), сшивает их
 * по индексу. Любая кривизна (не JSON / нет колонок / нечисловые / час вне 0..23) —
 * пропускаем молча: пустой/битый граф → пустой список (мягкая деградация).
 */
export function parseTopHoursGraph(jsonData: string): TopHour[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonData);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const columns = (parsed as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) {
    return [];
  }

  let xCol: unknown[] | null = null;
  let yCol: unknown[] | null = null;
  for (const col of columns) {
    if (!Array.isArray(col) || col.length === 0) {
      continue;
    }
    const label = col[0];
    if (label === "x") {
      xCol = col;
    } else if (
      typeof label === "string" &&
      label.startsWith("y") &&
      yCol === null
    ) {
      yCol = col;
    }
  }
  if (xCol === null || yCol === null) {
    return [];
  }

  const result: TopHour[] = [];
  const len = Math.min(xCol.length, yCol.length);
  for (let i = 1; i < len; i++) {
    // индекс 0 — метка колонки ("x"/"y0")
    const hour = xCol[i];
    const value = yCol[i];
    if (isHour(hour) && typeof value === "number") {
      result.push({ hour, value });
    }
  }
  return result;
}

/**
 * Парсит и ранжирует часы по убыванию активности (лучший час — первым). При равенстве —
 * по возрастанию часа (детерминизм). Дубли часов не схлопываем (граф их не содержит).
 */
export function rankTopHours(jsonData: string): TopHour[] {
  return parseTopHoursGraph(jsonData).sort(
    (a, b) => b.value - a.value || a.hour - b.hour,
  );
}
