import {
  requestApprovalForDraft,
  type ApprovalDraft,
  type PostingDeps,
} from "../postingService.js";
import { generatePostDraft } from "./aiGenerationService.js";
import { getSamplePosts } from "../../db/repositories/postRepository.js";
import {
  getPostingChannelById,
  type PostingChannel,
} from "../../db/repositories/channelRepository.js";
import { assignExperimentVariant } from "../experiments/experimentService.js";

/**
 * Сервис «AI-пост в очередь одобрения» (Шаг 10b) + сборщик AI-черновика (10c).
 * Оркестрация поверх фундамента 10a: образцы стиля канала → Claude пишет черновик →
 * общий путь очереди одобрения (`requestApprovalForDraft`), так что «✅ Опубликовать» /
 * «✍️ Изменить текст» / «🔄 Другое фото» работают без правок.
 *
 * `buildAiDraft` выделен отдельно, чтобы переиспользоваться и в кнопке меню (10b), и
 * в автопостинге (10c: генерим пост, когда на слот нет готового). Мягкая деградация:
 * нет ключа/образцов или модель не ответила → результат-union, НЕ исключение.
 */

/** Ключ Anthropic теперь в базовом `PostingDeps` — отдельный тип оставлен для читаемости. */
export type AiPostApprovalDeps = PostingDeps;

/** Сколько постов канала берём как образцы стиля для промпта. */
const SAMPLE_LIMIT = 6;

/** Причины, по которым AI-черновик не удалось собрать (для тоста/лога). */
export type AiDraftFailure = "no_key" | "no_samples" | "gen_failed";

/** Результат сборки AI-черновика: готовый снимок для очереди или причина отказа. */
export type AiDraftResult =
  | { ok: true; draft: ApprovalDraft }
  | { ok: false; reason: AiDraftFailure };

/** Результат постановки AI-поста в очередь (кнопка меню 10b). */
export type AiPostApprovalResult =
  | { ok: true }
  | { ok: false; reason: "no_key" | "no_channel" | "no_samples" | "gen_failed" };

/**
 * Собирает AI-черновик голосом канала (10c). Порядок проверок — от дешёвых к дорогим:
 * ключ → образцы → генерация. Канал уже разрешён вызывающим (у автопостинга он есть).
 * Возвращает `ApprovalDraft` (externalId=null — источник AI, не контент-план) с
 * `pexelsQuery` черновика, чтобы работал reroll фото.
 */
export async function buildAiDraft(
  deps: AiPostApprovalDeps,
  channel: PostingChannel,
): Promise<AiDraftResult> {
  const apiKey = deps.anthropicApiKey;
  if (apiKey === undefined || apiKey === "") {
    return { ok: false, reason: "no_key" };
  }
  const examples = await getSamplePosts(deps.prisma, channel.id, SAMPLE_LIMIT);
  if (examples.length === 0) {
    return { ok: false, reason: "no_samples" };
  }

  const draft = await generatePostDraft(
    { logger: deps.logger, apiKey, timeoutMs: deps.timeoutMs },
    { channelTitle: channel.title, examples },
  );
  if (draft === null) {
    return { ok: false, reason: "gen_failed" };
  }

  return {
    ok: true,
    draft: {
      title: draft.title,
      text: draft.text,
      cta: draft.cta,
      externalId: null,
      pexelsQuery: draft.pexelsQuery,
      photoSources: {
        photoUrl: null,
        pexelsQuery: draft.pexelsQuery,
        photoPath: null,
      },
    },
  };
}

/**
 * Генерирует AI-черновик и ставит его в очередь одобрения (кнопка «🤖 AI-пост», 10b).
 * Порядок проверок — ключ → канал → образцы → генерация; результат-union для тоста.
 */
export async function requestAiPostApproval(
  deps: AiPostApprovalDeps,
  channelId: string,
): Promise<AiPostApprovalResult> {
  // Проверки от дешёвых к дорогим: ключ → канал → (образцы → генерация в buildAiDraft).
  if (deps.anthropicApiKey === undefined || deps.anthropicApiKey === "") {
    return { ok: false, reason: "no_key" };
  }
  const channel = await getPostingChannelById(deps.prisma, channelId);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  const built = await buildAiDraft(deps, channel);
  if (!built.ok) {
    return { ok: false, reason: built.reason };
  }
  // Шаг 13b — активен эксперимент → назначаем AI-посту вариант (ротация). Вариант
  // резервируем ПОСЛЕ успешной сборки черновика, чтобы неудача генерации не двигала
  // счётчик ротации. Нет эксперимента → null (пост вне эксперимента).
  const variantKey = await assignExperimentVariant(deps, channel.id);
  await requestApprovalForDraft(deps, channel.id, channel.chatId, {
    ...built.draft,
    variantKey,
  });
  deps.logger.info({ channelId: channel.id }, "AI-пост поставлен в очередь одобрения");
  return { ok: true };
}
