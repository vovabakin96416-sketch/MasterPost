/**
 * Построитель промпта для AI-генерации поста (Шаг 10). ЧИСТАЯ функция: по названию
 * канала + примерам его постов (образцы стиля) собирает детерминированную пару
 * system/user для Claude. Ни сети, ни SDK — поэтому покрыто тестами.
 *
 * Тематики в коде НЕТ: тон канала выводится из его же постов (niche-agnostic), язык —
 * язык примеров. Это и есть «память канала» из плана. Тема (`topic`) необязательна:
 * без неё модель выбирает свежий угол сама (10a); ввод темы из меню — задача 10b.
 */

/** Пример поста канала — образец стиля для промпта. */
export interface PostPromptExample {
  title: string;
  text: string;
  cta: string;
}

/** Вход построителя промпта. */
export interface PostPromptInput {
  channelTitle: string;
  examples: PostPromptExample[];
  topic?: string | null;
  /**
   * Директива варианта активного эксперимента (Шаг 13c) — указание по ФОРМЕ поста
   * (стиль CTA / фото / длина / заголовок) из каталога `EXPERIMENT_DIMENSIONS`.
   * Пусто/нет → обычная генерация без эксперимента.
   */
  variantDirective?: string | null;
}

/** Готовая пара сообщений для `messages.create`. */
export interface PostPrompt {
  system: string;
  user: string;
}

const SYSTEM = [
  "Ты — опытный редактор Telegram-канала. Напиши ОДИН новый пост в том же стиле,",
  "тоне и на том же языке, что и примеры постов канала ниже.",
  "",
  "Требования:",
  "- Пиши на языке примеров (обычно русский).",
  "- Сохраняй tone of voice канала: лексику, длину, эмодзи, обращение к читателю.",
  "- Тема должна быть свежей — НЕ повторяй темы примеров.",
  "- Пост из трёх частей: заголовок (title), основной текст (text), призыв к действию (cta).",
  "- Подбери короткий запрос для поиска стокового фото к посту — поле pexelsQuery,",
  '  на АНГЛИЙСКОМ (например "tarot cards candle"), или пустую строку, если фото не нужно.',
  "",
  "Верни СТРОГО JSON-объект с полями: title, text, cta, pexelsQuery.",
  "Без markdown и пояснений — только JSON.",
].join("\n");

/** Форматирует один пример поста в блок для user-сообщения. */
function formatExample(example: PostPromptExample, index: number): string {
  return [
    `${String(index + 1)}) Заголовок: ${example.title}`,
    `Текст: ${example.text}`,
    `CTA: ${example.cta}`,
  ].join("\n");
}

/** Собирает пару system/user из данных канала (детерминированно). */
export function buildPostPrompt(input: PostPromptInput): PostPrompt {
  const examples = input.examples.map(formatExample).join("\n\n");
  const topic = input.topic?.trim();
  const topicLine =
    topic !== undefined && topic !== ""
      ? `Тема нового поста: ${topic}`
      : "Тему выбери сам — что-то новое и уместное для этого канала.";

  // Шаг 13c — директива активного эксперимента (форма поста). Влияет ТОЛЬКО на форму,
  // тему/стиль по-прежнему диктуют образцы канала. Пусто → блока в промпте нет.
  const directive = input.variantDirective?.trim();
  const directiveBlock =
    directive !== undefined && directive !== ""
      ? ["", `Особое указание для этого поста: ${directive}`]
      : [];

  const user = [
    `Канал: ${input.channelTitle}`,
    "",
    "Примеры постов канала (образцы стиля):",
    "",
    examples,
    "",
    topicLine,
    ...directiveBlock,
    "",
    "Напиши один новый пост в этом стиле.",
  ].join("\n");

  return { system: SYSTEM, user };
}
