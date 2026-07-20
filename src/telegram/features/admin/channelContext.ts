import { pickSelectedId } from "../../../core/menu/selectChannel.js";
import {
  getChannelById,
  getPostingChannelById,
  listChannelsByOwner,
  type ActiveChannel,
  type ChannelListItem,
  type PostingChannel,
} from "../../../db/repositories/channelRepository.js";
import { findOwnerByTelegramId } from "../../../db/repositories/ownerRepository.js";
import type { PrismaClient } from "../../../db/client.js";
import type { AdminDeps, MenuViewer } from "./types.js";

/**
 * Контекст «текущего канала» меню (Шаг 8a, мультиканальность; Шаг 14b-1, мультитенант).
 *
 * С 14b-1 меню открыто любому зарегистрированному владельцу, поэтому список каналов
 * СКОУПЛЕН: `listChannelsByOwner(viewer.ownerId)` вместо всех каналов. Это же закрывает
 * дыру переключателя — канал выбирается по индексу в списке владельца, до чужого канала
 * крафтнутый callback не дотянется (индекс мимо списка → экран каналов заново).
 *
 * Выбор храним in-memory по Telegram user id пользователя (по образцу `PendingInput`
 * Шага 3): эфемерно, теряется при рестарте — тогда `pickSelectedId` падает на первый
 * канал владельца.
 *
 * ⚠️ Рантайм (автопостинг/триггеры/аналитика) этот модуль НЕ использует — он ведёт
 * все активные каналы независимо от владельцев.
 */

const selected = new Map<number, string>();

/**
 * Гейт меню (Шаг 14b-1): пользователь Telegram → зарегистрированный владелец, или
 * `null` (не приглашён — меню закрыто). Супервладелец зарегистрирован всегда
 * (`ensureOwner(ADMIN_ID)` на старте, 14a).
 */
export async function resolveMenuViewer(
  prisma: PrismaClient,
  userId: number,
): Promise<MenuViewer | null> {
  const owner = await findOwnerByTelegramId(prisma, userId);
  return owner === null ? null : { userId, ownerId: owner.id };
}

/** Запоминает выбранный пользователем канал (после переключения в меню). */
export function setSelectedChannel(userId: number, channelId: string): void {
  selected.set(userId, channelId);
}

/** Список каналов владельца + id текущего одним запросом — для экранов раздела «Каналы» и шапки меню. */
export async function resolveChannelMenu(
  deps: AdminDeps,
): Promise<{ channels: ChannelListItem[]; currentId: string | null }> {
  const channels = await listChannelsByOwner(deps.prisma, deps.viewer.ownerId);
  const currentId = pickSelectedId(selected.get(deps.viewer.userId), channels);
  return { channels, currentId };
}

/** Id канала, с которым сейчас работает меню (выбранный или первый — см. `pickSelectedId`). */
export async function resolveSelectedChannelId(
  deps: AdminDeps,
): Promise<string | null> {
  const { currentId } = await resolveChannelMenu(deps);
  return currentId;
}

/** Drop-in замена `getActiveChannel(deps.prisma)` для разделов меню (Шаг 8a). */
export async function resolveSelectedChannel(
  deps: AdminDeps,
): Promise<ActiveChannel | null> {
  const id = await resolveSelectedChannelId(deps);
  return id === null ? null : getChannelById(deps.prisma, id);
}

/** Drop-in замена `getPostingChannel(deps.prisma)` для экранов автопостинга/аналитики (Шаг 8a). */
export async function resolvePostingChannelSelected(
  deps: AdminDeps,
): Promise<PostingChannel | null> {
  const id = await resolveSelectedChannelId(deps);
  return id === null ? null : getPostingChannelById(deps.prisma, id);
}
