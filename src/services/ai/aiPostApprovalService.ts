import {
  requestApprovalForDraft,
  type PostingDeps,
} from "../postingService.js";
import { generatePostDraft } from "./aiGenerationService.js";
import { getSamplePosts } from "../../db/repositories/postRepository.js";
import { getPostingChannelById } from "../../db/repositories/channelRepository.js";

/**
 * Сервис «AI-пост в очередь одобрения» (Шаг 10b) — оркестрация поверх фундамента
 * 10a. Собирает образцы стиля канала → просит Claude сгенерировать черновик →
 * кладёт его в ту же очередь одобрения, что и плановый пост (общий путь
 * `requestApprovalForDraft`). Превью с кнопками уходит админу тем же кодом, поэтому
 * «✅ Опубликовать» / «✍️ Изменить текст» / «🔄 Другое фото» работают без правок.
 *
 * Мягкая деградация: нет ключа/образцов/канала или модель не ответила → понятный
 * результат для тоста, НЕ исключение (кнопка меню не должна ронять обработчик).
 */

/** Сколько постов канала берём как образцы стиля для промпта. */
const SAMPLE_LIMIT = 6;

/** Зависимости: всё для публикации (`PostingDeps`) + ключ Anthropic для генерации. */
export interface AiPostApprovalDeps extends PostingDeps {
  readonly anthropicApiKey: string | undefined;
}

/** Результат постановки AI-поста в очередь (для тоста админу). */
export type AiPostApprovalResult =
  | { ok: true }
  | { ok: false; reason: "no_key" | "no_channel" | "no_samples" | "gen_failed" };

/**
 * Генерирует AI-черновик голосом канала и ставит его в очередь одобрения. Порядок
 * проверок — от дешёвых к дорогим: ключ → канал → образцы → генерация.
 */
export async function requestAiPostApproval(
  deps: AiPostApprovalDeps,
  channelId: string,
): Promise<AiPostApprovalResult> {
  const apiKey = deps.anthropicApiKey;
  if (apiKey === undefined || apiKey === "") {
    return { ok: false, reason: "no_key" };
  }
  const channel = await getPostingChannelById(deps.prisma, channelId);
  if (channel === null) {
    return { ok: false, reason: "no_channel" };
  }
  const examples = await getSamplePosts(deps.prisma, channel.id, SAMPLE_LIMIT);
  if (examples.length === 0) {
    return { ok: false, reason: "no_samples" };
  }

  const draft = await generatePostDraft(
    { logger: deps.logger, apiKey },
    { channelTitle: channel.title, examples },
  );
  if (draft === null) {
    return { ok: false, reason: "gen_failed" };
  }

  // Снимок без externalId (источник — AI, не контент-план). Фото предзагрузим по
  // pexelsQuery черновика; его же кэшируем в очереди, чтобы работал reroll.
  await requestApprovalForDraft(deps, channel.id, channel.chatId, {
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
  });
  deps.logger.info({ channelId: channel.id }, "AI-пост поставлен в очередь одобрения");
  return { ok: true };
}
