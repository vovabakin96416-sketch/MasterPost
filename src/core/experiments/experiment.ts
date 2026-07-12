/**
 * Experiment Engine (Шаг 13a) — типы и каталог измерений. ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Эксперимент проверяет ОДНО измерение контента (стиль CTA, фото, длина, заголовок) —
 * при 1–2 постах в день выборки малы, несколько измерений сразу не различить. Варианты
 * измерения чередуются между постами (см. `assignVariant`), победитель — по ERR
 * (см. `evaluateExperiment`). Каталог niche-agnostic: тематика канала сюда не течёт,
 * как вариант влияет на генерацию/публикацию — решает слой вживления (13c).
 */

/** Измерение эксперимента — ЧТО варьируем между постами. */
export type ExperimentDimension = "cta_style" | "media" | "length" | "headline_style";

/** Вариант измерения: ключ для хранения + подпись для меню/отчёта. */
export interface ExperimentVariant {
  readonly key: string;
  readonly label: string;
}

/** Описание измерения: подпись + варианты (ровно 2 — минимальные выборки). */
export interface DimensionSpec {
  readonly dimension: ExperimentDimension;
  readonly label: string;
  readonly variants: readonly ExperimentVariant[];
}

/** Фиксированный каталог измерений на старте (решение владельца, план 13). */
export const EXPERIMENT_DIMENSIONS: readonly DimensionSpec[] = [
  {
    dimension: "cta_style",
    label: "Стиль CTA",
    variants: [
      { key: "question", label: "Вопрос к аудитории" },
      { key: "action", label: "Призыв к действию" },
    ],
  },
  {
    dimension: "media",
    label: "Фото в посте",
    variants: [
      { key: "with_photo", label: "С фото" },
      { key: "no_photo", label: "Без фото" },
    ],
  },
  {
    dimension: "length",
    label: "Длина поста",
    variants: [
      { key: "short", label: "Короткий" },
      { key: "long", label: "Длинный" },
    ],
  },
  {
    dimension: "headline_style",
    label: "Стиль заголовка",
    variants: [
      { key: "intrigue", label: "Интрига" },
      { key: "plain", label: "Прямой" },
    ],
  },
];

/** Спецификация измерения по ключу; неизвестное → null. */
export function getDimensionSpec(dimension: string): DimensionSpec | null {
  return EXPERIMENT_DIMENSIONS.find((d) => d.dimension === dimension) ?? null;
}
