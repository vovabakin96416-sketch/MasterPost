/**
 * Experiment Engine (Шаг 13a) — типы и каталог измерений. ЧИСТАЯ логика (без Telegram/БД/AI).
 *
 * Эксперимент проверяет ОДНО измерение контента (стиль CTA, фото, длина, заголовок) —
 * при 1–2 постах в день выборки малы, несколько измерений сразу не различить. Варианты
 * измерения чередуются между постами (см. `assignVariant`), победитель — по ERR
 * (см. `evaluateExperiment`). Каталог niche-agnostic: тематика канала сюда не течёт,
 * как вариант влияет на генерацию/публикацию — решает слой вживления (13c).
 */

/**
 * Ключи измерений каталога (фиксированный порядок). Единый источник для типа и для
 * enum-валидации AI-советника (13f) — модель обязана выбрать один из этих ключей.
 */
export const EXPERIMENT_DIMENSION_KEYS = [
  "cta_style",
  "media",
  "length",
  "headline_style",
] as const;

/** Измерение эксперимента — ЧТО варьируем между постами. */
export type ExperimentDimension = (typeof EXPERIMENT_DIMENSION_KEYS)[number];

/**
 * Вариант измерения: ключ для хранения + подпись для меню/отчёта + `directive` —
 * текст-указание для промпта генерации (Шаг 13c). Директива niche-agnostic: она
 * задаёт ФОРМУ поста (как завершить, длину, стиль заголовка/фото), а не тематику —
 * тема по-прежнему выводится из образцов канала. Пусто в `directive` быть не должно.
 */
export interface ExperimentVariant {
  readonly key: string;
  readonly label: string;
  readonly directive: string;
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
      {
        key: "question",
        label: "Вопрос к аудитории",
        directive:
          "Заверши пост призывом-вопросом к читателю: задай открытый вопрос в конце, чтобы вовлечь в обсуждение.",
      },
      {
        key: "action",
        label: "Призыв к действию",
        directive:
          "Заверши пост чётким призывом к действию: прямо попроси читателя откликнуться (написать слово, подписаться, поставить реакцию).",
      },
    ],
  },
  {
    dimension: "media",
    label: "Фото в посте",
    variants: [
      {
        key: "with_photo",
        label: "С фото",
        directive:
          "К посту обязательно нужно фото — заполни поле pexelsQuery подходящим запросом на английском (не оставляй пустым).",
      },
      {
        key: "no_photo",
        label: "Без фото",
        directive: "Пост идёт без фото — верни пустую строку в поле pexelsQuery.",
      },
    ],
  },
  {
    dimension: "length",
    label: "Длина поста",
    variants: [
      {
        key: "short",
        label: "Короткий",
        directive:
          "Сделай пост коротким и ёмким — 2–3 небольших абзаца, только суть, без воды.",
      },
      {
        key: "long",
        label: "Длинный",
        directive:
          "Сделай пост развёрнутым — подробно раскрой тему в нескольких абзацах, с деталями и примерами.",
      },
    ],
  },
  {
    dimension: "headline_style",
    label: "Стиль заголовка",
    variants: [
      {
        key: "intrigue",
        label: "Интрига",
        directive:
          "Заголовок сделай интригующим — с недосказанностью, чтобы захотелось раскрыть пост.",
      },
      {
        key: "plain",
        label: "Прямой",
        directive:
          "Заголовок сделай прямым и ясным — чётко назови суть поста, без загадок.",
      },
    ],
  },
];

/** Спецификация измерения по ключу; неизвестное → null. */
export function getDimensionSpec(dimension: string): DimensionSpec | null {
  return EXPERIMENT_DIMENSIONS.find((d) => d.dimension === dimension) ?? null;
}
