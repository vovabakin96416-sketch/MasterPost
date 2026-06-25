import { InlineKeyboard } from "grammy";
import type { PrismaClient } from "../db/client.js";
import {
  getBooleanSetting,
  toggleBooleanSetting,
} from "../db/repositories/settingRepository.js";
import { encodeApproval } from "../core/approval/callback.js";

/**
 * Сервис одобрения постов (Шаг 5). Здесь живут ключ настройки и клавиатура превью,
 * чтобы планировщик (решает: слать на одобрение или сразу) и меню (тумблер) брали
 * их из одного места. Тематики нет — поведение общее для любого канала.
 *
 * Чистые построители (подпись/снимок) — в `core/approval`, переэкспортируем для
 * удобства вызывающих.
 */

export { buildApprovalCaption } from "../core/approval/caption.js";
export type { PostSnapshot } from "../core/approval/caption.js";

/** Ключ настройки «спрашивать одобрение перед публикацией». */
export const APPROVAL_KEY = "approval_enabled";

/**
 * По умолчанию ВКЛ (как в Python: `DEFAULT_SETTINGS["approval_enabled"] = True`):
 * пока админ не отключит, посты идут на превью, а не сразу в канал — осторожное
 * поведение для нетехнического владельца.
 */
export const DEFAULT_APPROVAL_ENABLED = true;

/** Включено ли одобрение для канала. */
export async function isApprovalEnabled(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return getBooleanSetting(prisma, channelId, APPROVAL_KEY, DEFAULT_APPROVAL_ENABLED);
}

/** Переключает одобрение и возвращает новое значение (тумблер меню). */
export async function toggleApproval(
  prisma: PrismaClient,
  channelId: string,
): Promise<boolean> {
  return toggleBooleanSetting(prisma, channelId, APPROVAL_KEY, DEFAULT_APPROVAL_ENABLED);
}

/**
 * Клавиатура превью одобрения — 6 кнопок (порт `approval_keyboard`, паритет с
 * Python). Шаг 6a добавил фото-кнопки «🔄 Другое фото» / «🖼 Своё фото».
 */
export function approvalKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Опубликовать", encodeApproval("pub", pendingId))
    .text("🔄 Другое фото", encodeApproval("reroll", pendingId))
    .row()
    .text("✍️ Изменить текст", encodeApproval("edit", pendingId))
    .text("🖼 Своё фото", encodeApproval("own", pendingId))
    .row()
    .text("⏭ Не сегодня", encodeApproval("skip", pendingId))
    .text("❌ Отменить", encodeApproval("cancel", pendingId));
}
