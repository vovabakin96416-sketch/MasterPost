import { pickSelectedId } from "../../../core/menu/selectChannel.js";
import {
  getChannelById,
  getPostingChannelById,
  listChannels,
  type ActiveChannel,
  type ChannelListItem,
  type PostingChannel,
} from "../../../db/repositories/channelRepository.js";
import type { AdminDeps } from "./types.js";

/**
 * Контекст «текущего канала» меню админа (Шаг 8a, мультиканальность).
 *
 * Схема БД мультиканальна с Шага 1 (все функции принимают `channelId`); до Шага 8
 * меню всегда работало с «первым активным» каналом (`getActiveChannel`). Здесь мы
 * заменяем это на «канал, выбранный владельцем», сохраняя тот же тип возврата —
 * замены `getActiveChannel`/`getPostingChannel` в меню получаются механическими.
 *
 * Выбор храним in-memory (по образцу `PendingInput` Шага 3): эфемерно, теряется при
 * рестарте — тогда `pickSelectedId` падает на первый канал. Для одного владельца
 * этого достаточно; персистентность — задел на мульти-владельца (Шаг 9).
 *
 * ⚠️ Рантайм (автопостинг/триггеры/аналитика) этот модуль НЕ использует — он и
 * дальше берёт первый активный канал, пока мультиканальный рантайм не сделан в 8b/8c.
 */

const selected = new Map<number, string>();

/** Запоминает выбранный админом канал (после переключения в меню). */
export function setSelectedChannel(adminId: number, channelId: string): void {
  selected.set(adminId, channelId);
}

/** Список каналов + id текущего одним запросом — для экранов раздела «Каналы» и шапки меню. */
export async function resolveChannelMenu(
  deps: AdminDeps,
): Promise<{ channels: ChannelListItem[]; currentId: string | null }> {
  const channels = await listChannels(deps.prisma);
  const currentId = pickSelectedId(selected.get(deps.adminId), channels);
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
