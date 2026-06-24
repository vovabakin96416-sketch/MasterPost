import type { PrismaClient } from "../client.js";

/**
 * Идемпотентно создаёт/обновляет пул текстов канала по паре (channelId, key).
 */
export async function upsertTextPool(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  texts: string[],
): Promise<void> {
  await prisma.textPool.upsert({
    where: { channelId_key: { channelId, key } },
    create: { channelId, key, texts },
    update: { texts },
  });
}

/**
 * Возвращает тексты пула по паре (channelId, key) или `null`, если пула нет.
 * Используется триггерами (Шаг 2): ключ пула = совпавшее слово-триггер.
 */
export async function getTextPool(
  prisma: PrismaClient,
  channelId: string,
  key: string,
): Promise<string[] | null> {
  const pool = await prisma.textPool.findUnique({
    where: { channelId_key: { channelId, key } },
    select: { texts: true },
  });
  return pool ? pool.texts : null;
}

/** Сводка по триггеру для списка в меню: слово + число ответов в его пуле. */
export interface TriggerSummary {
  readonly word: string;
  readonly count: number;
}

/**
 * Для каждого слова-триггера возвращает число ответов в его пуле (Шаг 3, экран
 * списка триггеров: «карта · 7 ответов ›»). Порядок повторяет `words` (порядок
 * канала). Слова без пула → 0.
 */
export async function listTriggerSummaries(
  prisma: PrismaClient,
  channelId: string,
  words: readonly string[],
): Promise<TriggerSummary[]> {
  const pools = await prisma.textPool.findMany({
    where: { channelId, key: { in: [...words] } },
    select: { key: true, texts: true },
  });
  const counts = new Map(pools.map((p) => [p.key, p.texts.length]));
  return words.map((word) => ({ word, count: counts.get(word) ?? 0 }));
}

/** Добавляет один ответ в пул (создаёт пул, если его нет). Шаг 3. */
export async function addText(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  text: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pool = await tx.textPool.findUnique({
      where: { channelId_key: { channelId, key } },
      select: { texts: true },
    });
    const texts = pool ? [...pool.texts, text] : [text];
    await tx.textPool.upsert({
      where: { channelId_key: { channelId, key } },
      create: { channelId, key, texts: [text] },
      update: { texts: { set: texts } },
    });
  });
}

/**
 * Заменяет ответ по индексу. Возвращает `false`, если пула нет или индекс вне
 * диапазона (список мог измениться между рендером и нажатием). Шаг 3.
 */
export async function updateText(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  index: number,
  text: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const pool = await tx.textPool.findUnique({
      where: { channelId_key: { channelId, key } },
      select: { texts: true },
    });
    if (pool === null || index < 0 || index >= pool.texts.length) {
      return false;
    }
    const next = [...pool.texts];
    next[index] = text;
    await tx.textPool.update({
      where: { channelId_key: { channelId, key } },
      data: { texts: { set: next } },
    });
    return true;
  });
}

/**
 * Удаляет ответ по индексу. Возвращает `false`, если пула нет или индекс вне
 * диапазона. Шаг 3.
 */
export async function removeText(
  prisma: PrismaClient,
  channelId: string,
  key: string,
  index: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const pool = await tx.textPool.findUnique({
      where: { channelId_key: { channelId, key } },
      select: { texts: true },
    });
    if (pool === null || index < 0 || index >= pool.texts.length) {
      return false;
    }
    const next = pool.texts.filter((_, i) => i !== index);
    await tx.textPool.update({
      where: { channelId_key: { channelId, key } },
      data: { texts: { set: next } },
    });
    return true;
  });
}
