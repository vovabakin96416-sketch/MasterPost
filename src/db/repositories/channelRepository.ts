import type { PrismaClient } from "../client.js";

/** Данные канала под upsert. Nullable-поля передаём явно (null, не undefined). */
export interface ChannelSeed {
  title: string;
  username: string;
  niche: string;
  language: string;
  region: string | null;
  goal: string | null;
  toneOfVoice: string | null;
  timezone: string;
  triggerWords: string[];
  isActive: boolean;
  campaignStart: Date | null;
}

/**
 * Идемпотентно создаёт/обновляет канал по уникальному username.
 * Возвращает id канала — он нужен как внешний ключ для постов и пулов.
 */
export async function upsertChannel(
  prisma: PrismaClient,
  data: ChannelSeed,
): Promise<string> {
  const channel = await prisma.channel.upsert({
    where: { username: data.username },
    create: data,
    update: data,
    select: { id: true },
  });
  return channel.id;
}
