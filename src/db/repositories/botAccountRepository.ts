import type { PrismaClient } from "../client.js";

/**
 * Репозиторий bot-аккаунтов (Шаг 14b-bis-1) — свой бот клиента вместо общего.
 *
 * ⚠️ Репозиторий НЕ шифрует и НЕ расшифровывает: он пишет и читает уже
 * зашифрованную строку (`tokenCipher`). Ключ живёт в env и известен только
 * сервису — так «достать токен» нельзя, случайно дёрнув репозиторий.
 *
 * В 14b-bis-1 записи только копятся: процесс поднимает один бот из env.
 * Их чтение для запуска — `listActiveBotAccounts` в 14b-bis-2.
 */

/** Bot-аккаунт в форме, нужной экрану меню и (с 14b-bis-2) запуску процесса. */
export interface BotAccountRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly botUserId: string;
  readonly username: string;
  readonly tokenCipher: string;
  readonly isActive: boolean;
  readonly lastError: string | null;
  readonly createdAt: Date;
}

const BOT_ACCOUNT_SELECT = {
  id: true,
  ownerId: true,
  botUserId: true,
  username: true,
  tokenCipher: true,
  isActive: true,
  lastError: true,
  createdAt: true,
} as const;

/** Bot-аккаунт владельца, или `null`. Основа экрана «🤖 Мой бот». */
export async function getBotAccountByOwner(
  prisma: PrismaClient,
  ownerId: string,
): Promise<BotAccountRecord | null> {
  return prisma.botAccount.findUnique({
    where: { ownerId },
    select: BOT_ACCOUNT_SELECT,
  });
}

/** Владелец бота по числовому id бота — проверка «этот бот уже у кого-то занят». */
export async function findBotAccountByBotUserId(
  prisma: PrismaClient,
  botUserId: string,
): Promise<BotAccountRecord | null> {
  return prisma.botAccount.findUnique({
    where: { botUserId },
    select: BOT_ACCOUNT_SELECT,
  });
}

/** Данные подключаемого бота (токен уже зашифрован вызывающим). */
export interface BotAccountInput {
  readonly ownerId: string;
  readonly botUserId: string;
  readonly username: string;
  readonly tokenCipher: string;
}

/**
 * Подключает или ЗАМЕНЯЕТ бота владельца (`ownerId` — `@unique`, один бот на
 * владельца). Замена сбрасывает `lastError` и снова включает аккаунт: владелец
 * прислал новый токен именно потому, что хочет рабочего бота.
 */
export async function saveBotAccount(
  prisma: PrismaClient,
  input: BotAccountInput,
): Promise<BotAccountRecord> {
  const { ownerId, ...rest } = input;
  return prisma.botAccount.upsert({
    where: { ownerId },
    create: { ownerId, ...rest },
    update: { ...rest, isActive: true, lastError: null },
    select: BOT_ACCOUNT_SELECT,
  });
}

/**
 * Отключает бота владельца (удаляет запись вместе с токеном). Возвращает `false`,
 * если записи уже нет — гонка двух нажатий, вызывающий просто перерисует экран.
 *
 * Удаляем, а не гасим флагом: хранить секрет, который больше не нужен, — риск без
 * пользы. Владелец в любой момент вставит токен заново (в BotFather он не меняется).
 */
export async function removeBotAccount(
  prisma: PrismaClient,
  ownerId: string,
): Promise<boolean> {
  const result = await prisma.botAccount.deleteMany({ where: { ownerId } });
  return result.count > 0;
}

/**
 * Все включённые bot-аккаунты — вход для запуска ботов клиентов в 14b-bis-2.
 * Порядок детерминированный (по дате подключения): лог старта должен читаться
 * одинаково от перезапуска к перезапуску.
 */
export async function listActiveBotAccounts(
  prisma: PrismaClient,
): Promise<BotAccountRecord[]> {
  return prisma.botAccount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: BOT_ACCOUNT_SELECT,
  });
}
