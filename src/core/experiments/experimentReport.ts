/**
 * Форматтер прогресса эксперимента (Шаг 13d) — ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Превращает вердикт `evaluateExperiment` (13a) + подписи вариантов каталога (13a) в
 * человекочитаемый текст «вариант А: N постов, ERR X% · … · статус». Как
 * `buildInsightsReport` (12c) — здесь только сборка строк.
 *
 * ⚠️ БЕЗ Markdown-эмфазы (`*`/`_`): один текст идёт и на экран «🧪 Эксперименты»
 * (editMessageText БЕЗ parse_mode), и в еженедельный отчёт (Markdown-сообщение).
 * Эмодзи + структура читаются одинаково в обоих местах; звёздочки были бы сором.
 */

import { pluralRu } from "../text/pluralRu.js";
import type { ExperimentVerdict } from "./evaluateExperiment.js";

/** Заголовок секции (виден и на экране, и в отчёте). */
const HEADER = "🧪 Эксперимент";

/** Склонение «пост/поста/постов». */
const pluralPosts = (n: number): string => pluralRu(n, ["пост", "поста", "постов"]);

/** ERR (доля 0..1) → «3.1%». */
function pct(err: number): string {
  return `${(err * 100).toFixed(1)}%`;
}

/** Данные для форматирования: измерение + дата старта + подписи вариантов + вердикт. */
export interface ExperimentReportInput {
  readonly dimensionLabel: string;
  readonly startedLabel: string; // «12.07» (форматирует слой с поясом канала)
  readonly variantLabels: Readonly<Record<string, string>>; // ключ варианта → подпись
  readonly verdict: ExperimentVerdict;
}

/**
 * Текст прогресса эксперимента: строка на каждый вариант (число чистых постов + ERR)
 * плюс строка статуса из вердикта. Подпись варианта берём из каталога; неизвестный
 * ключ (теоретически) → сам ключ.
 */
export function buildExperimentReport(input: ExperimentReportInput): string {
  const { dimensionLabel, startedLabel, variantLabels, verdict } = input;
  const lines: string[] = [
    HEADER,
    "",
    `Измерение: ${dimensionLabel}`,
    `Идёт с ${startedLabel}`,
    "",
  ];
  for (const result of verdict.results) {
    const label = variantLabels[result.key] ?? result.key;
    lines.push(
      `${label}: ${String(result.cleanCount)} ${pluralPosts(result.cleanCount)}, ERR ${pct(result.avgErr)}`,
    );
  }
  lines.push("", statusLine(verdict, variantLabels));
  return lines.join("\n");
}

/** Строка статуса по вердикту (13a). */
function statusLine(
  verdict: ExperimentVerdict,
  variantLabels: Readonly<Record<string, string>>,
): string {
  switch (verdict.status) {
    case "continue":
      return `Статус: копим данные — нужно ещё ~${String(verdict.postsNeeded)} ${pluralPosts(verdict.postsNeeded)}.`;
    case "no_difference":
      return `Статус: разницы между вариантами пока нет (Δ ${String(Math.round(verdict.deltaPct))}%).`;
    case "winner": {
      const label = variantLabels[verdict.variantKey] ?? verdict.variantKey;
      const delta =
        verdict.deltaPct === null ? "" : ` (+${String(Math.round(verdict.deltaPct))}% ERR)`;
      return `Статус: победил вариант «${label}»${delta}.`;
    }
    case "suspicious": {
      const label = variantLabels[verdict.variantKey] ?? verdict.variantKey;
      return (
        `Статус: вариант «${label}» даёт больше вовлечённости, но подписчики за период ` +
        "падали — возможно кликбейт, не применяем."
      );
    }
  }
}
