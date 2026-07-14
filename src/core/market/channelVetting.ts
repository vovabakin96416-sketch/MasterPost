import type { ChannelVettingStat } from "./marketData.js";
import type { SubscriberAnomaly } from "./subscriberAnomaly.js";
import type { SubscriberDynamics } from "./subscriberDynamics.js";

/**
 * Вет чужого канала перед закупкой рекламы (Шаг 12g) — ЧИСТАЯ логика
 * (без HTTP/БД/Telegram). Порт чек-листа скилла `telemetr-vetting` в объёме,
 * доступном HTTP-API Telemetr: превращает срез `/channels/stat` + ряд
 * подписчиков в автоматический вердикт первого прохода 🟢/🟡/🔴.
 *
 * Это НЕ замена ручного вета: API не видит имена зодиак-клонов в таблице
 * упоминаний, историю описаний (перевёртыш), тон/этику контента и SCAM-плашку.
 * Задача ядра — дёшево отсеять явную сетку/накрутку/падение. Текст без
 * Markdown-эмфазы (правило 12c) — идёт на плейн-экран `editMessageText`.
 */

// ── Пороги (именованные, niche-agnostic; калибровка на якорях скилла) ──────────

/** Охват/подписчик: ≥ этого — здоровый охват (доля, 0.05 = 5%). */
export const REACH_RATIO_GOOD = 0.05;
/** Охват/подписчик: ниже этого — накрутка/мёртвая аудитория. */
export const REACH_RATIO_BAD = 0.03;

/** ER%: нижняя граница нормы Башлыкова (ниже — вялая вовлечённость). */
export const ER_MIN = 5;
/** ER%: верхняя граница нормы (выше — подозрительно высокий / интерактивы). */
export const ER_MAX = 35;

/** Сеть упоминаний: до стольких каналов — органика. */
export const NETWORK_ORGANIC_MAX = 50;
/** Сеть упоминаний: свыше стольких — взаимопиар-сетка/ферма. */
export const NETWORK_FARM_MIN = 150;

/** Оценка качества Telemetr (0..10): от этого и выше — хорошо. */
export const SCORING_GOOD = 6;
/** Оценка качества: ниже этого — плохо. */
export const SCORING_BAD = 4;

/** Светофор одного сигнала. */
export type SignalLevel = "green" | "yellow" | "red";

/** Итоговый вердикт вета. */
export type VettingVerdict = "green" | "yellow" | "red";

/** Один проверенный сигнал: уровень + человекочитаемая строка для владельца. */
export interface VettingSignal {
  readonly level: SignalLevel;
  readonly text: string;
}

/** Результат вета: вердикт + список сигналов (в порядке важности). */
export interface VettingResult {
  readonly verdict: VettingVerdict;
  readonly signals: readonly VettingSignal[];
}

const DOT: Record<SignalLevel, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

/** Процент с одним знаком: 0.072 → «7.2%». */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Дельта со знаком всегда: «+14» / «-1255». */
function signed(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/**
 * Охват на подписчика — фильтр накрутки/мёртвой аудитории (Шаг 5 скилла:
 * «24к подп / 400 просм → накрутка»). РЕШАЮЩИЙ сигнал: сам по себе тянет 🔴.
 */
function reachSignal(stat: ChannelVettingStat): VettingSignal {
  if (stat.subscribers <= 0) {
    return { level: "yellow", text: "Охват на подписчика: нет данных" };
  }
  const ratio = stat.avgPostReach / stat.subscribers;
  const level: SignalLevel =
    ratio >= REACH_RATIO_GOOD
      ? "green"
      : ratio >= REACH_RATIO_BAD
        ? "yellow"
        : "red";
  const note =
    level === "red"
      ? " — похоже на накрутку/мёртвую аудиторию"
      : level === "yellow"
        ? " — низковат"
        : "";
  return { level, text: `Охват на подписчика: ${pct(ratio)}${note}` };
}

/**
 * Сеть упоминаний — детектор взаимопиар-сетки/фермы (Шаг 4 скилла, «главный»).
 * `mentioningChannelsCount` = в скольких РАЗНЫХ каналах упоминали. РЕШАЮЩИЙ: 🔴
 * сам тянет вердикт вниз (органика ~десятки, ферма — сотни).
 */
function networkSignal(stat: ChannelVettingStat): VettingSignal {
  const n = stat.mentioningChannelsCount;
  const level: SignalLevel =
    n <= NETWORK_ORGANIC_MAX ? "green" : n < NETWORK_FARM_MIN ? "yellow" : "red";
  const note =
    level === "red"
      ? " — похоже на взаимопиар-сетку/ферму"
      : level === "yellow"
        ? " — много, проверь вручную"
        : "";
  return {
    level,
    text: `Упоминаний из каналов: ${String(n)}${note}`,
  };
}

/** ER% — вовлечённость (норма Башлыкова 5–35%). */
function erSignal(stat: ChannelVettingStat): VettingSignal {
  const er = stat.errPercent;
  if (er >= ER_MIN && er <= ER_MAX) {
    return { level: "green", text: `ER: ${er.toFixed(1)}%` };
  }
  const note = er < ER_MIN ? " — вялая вовлечённость" : " — подозрительно высокий";
  return { level: "yellow", text: `ER: ${er.toFixed(1)}%${note}` };
}

/** Оценка качества Telemetr (0..10). */
function scoringSignal(stat: ChannelVettingStat): VettingSignal {
  const s = stat.scoringRate;
  const level: SignalLevel =
    s >= SCORING_GOOD ? "green" : s >= SCORING_BAD ? "yellow" : "red";
  return { level, text: `Оценка качества Telemetr: ${s.toFixed(1)}/10` };
}

/**
 * Тренд подписчиков за 28 дней — «канал растёт или сохнет» (скилл: «снижение
 * месяц к месяцу» = красный флаг). Нет ряда/базы → сигнала нет (`null`).
 */
function trendSignal(dynamics: SubscriberDynamics | null): VettingSignal | null {
  if (dynamics === null || dynamics.delta28d === null) {
    return null;
  }
  const d = dynamics.delta28d;
  const level: SignalLevel = d >= 0 ? "green" : "yellow";
  const note = d < 0 ? " — канал сохнет" : "";
  return { level, text: `Подписчики за 28д: ${signed(d)}${note}` };
}

/**
 * Резкие скачки ряда подписчиков (Шаг 12f) — накрутка/рекламные всплески.
 * Пустой ряд аномалий → сигнала нет (`null`).
 */
function anomalySignal(
  anomalies: readonly SubscriberAnomaly[],
): VettingSignal | null {
  if (anomalies.length === 0) {
    return null;
  }
  return {
    level: "yellow",
    text: `Резкие скачки подписчиков: ${String(anomalies.length)} за 28д — возможна накрутка/закуп`,
  };
}

/**
 * Считает вердикт по сигналам. Порт рубрики скилла «🔴 ≥2 красных флага», но
 * сетка и накрутка (Шаги 4/5, «главные») — РЕШАЮЩИЕ: любой из них 🔴 тянет
 * вердикт в 🔴 сам по себе. Иначе: два любых 🔴 → 🔴; один 🔴 → 🟡; ноль 🔴 при
 * наличии 🟡 → 🟡; всё зелёное → 🟢.
 */
function computeVerdict(
  signals: readonly VettingSignal[],
  decisiveRed: boolean,
): VettingVerdict {
  const reds = signals.filter((s) => s.level === "red").length;
  const yellows = signals.filter((s) => s.level === "yellow").length;
  if (decisiveRed || reds >= 2) {
    return "red";
  }
  if (reds === 1 || yellows > 0) {
    return "yellow";
  }
  return "green";
}

/**
 * Главная функция вета: срез Telemetr + динамика/аномалии ряда → вердикт +
 * сигналы. `dynamics`/`anomalies` могут быть пустыми (ряд не собрался) — тогда
 * тренд и скачки просто не участвуют.
 */
export function vetChannelStat(
  stat: ChannelVettingStat,
  dynamics: SubscriberDynamics | null = null,
  anomalies: readonly SubscriberAnomaly[] = [],
): VettingResult {
  const reach = reachSignal(stat);
  const network = networkSignal(stat);
  // Порядок = важность: решающие (накрутка/сетка) первыми, потом остальное.
  const signals: VettingSignal[] = [reach, network, erSignal(stat), scoringSignal(stat)];
  const trend = trendSignal(dynamics);
  if (trend !== null) {
    signals.push(trend);
  }
  const anomaly = anomalySignal(anomalies);
  if (anomaly !== null) {
    signals.push(anomaly);
  }
  const decisiveRed = reach.level === "red" || network.level === "red";
  return { verdict: computeVerdict(signals, decisiveRed), signals };
}

/** Заголовок вердикта для владельца. */
const VERDICT_TITLE: Record<VettingVerdict, string> = {
  green: "🟢 Похоже на живой канал — можно тестировать",
  yellow: "🟡 Спорно — годится разве что как дешёвый тест",
  red: "🔴 Не брать — есть красные флаги",
};

/**
 * Плейн-текст результата вета для экрана (без Markdown-эмфазы). Шапка с
 * названием + вердикт + сигналы построчно + честная приписка про ручной
 * доразбор (что API не видит).
 */
export function buildVettingReport(
  channelRef: string,
  stat: ChannelVettingStat,
  result: VettingResult,
): string {
  const lines: string[] = [];
  lines.push(`🔍 Проверка канала ${channelRef}`);
  lines.push(`Подписчиков: ${String(stat.subscribers)} · охват поста: ~${String(stat.avgPostReach)}`);
  lines.push("");
  lines.push(VERDICT_TITLE[result.verdict]);
  lines.push("");
  for (const s of result.signals) {
    lines.push(`${DOT[s.level]} ${s.text}`);
  }
  lines.push("");
  lines.push(
    "⚠️ Это автоматический первый фильтр по данным Telemetr. Он не видит имена " +
      "каналов-упоминателей (зодиак-клоны), историю названий/описаний, тон и этику " +
      "контента. Финалистов доразбери вручную: открой t.me/s/<ник> (лента) и " +
      "telemetr.me/<ник> (таблица упоминаний).",
  );
  return lines.join("\n");
}
