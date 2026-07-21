import type { PrismaClient } from "../client.js";

/**
 * Репозиторий владельцев (Шаг 14a) — фундамент мультитенанта.
 *
 * До 14a бот одно-арендный: доступ закрыт единственным `ADMIN_ID`, а каналы никому
 * не принадлежали. Здесь появляется личность владельца и связь «канал → владелец».
 *
 * ⚠️ В 14a по `ownerId` НИЧЕГО не фильтруется — меню/планировщик/роутер комментов
 * работают как раньше. Это сознательно: 14a кладёт каркас без смены поведения,
 * разграничение доступа включается в 14b.
 */

/** Владелец в форме, нужной гейту доступа и экрану «Владельцы» (14b). */
export interface OwnerRecord {
  id: string;
  telegramUserId: string;
  name: string | null;
}

/**
 * Идемпотентно заводит владельца по его Telegram user id и возвращает id строки.
 * Повторный вызов не плодит дублей (`telegramUserId` — `@unique`) и не затирает
 * уже сохранённое имя пустым: `name` обновляем, только если он передан.
 *
 * Telegram id приходит числом (`ctx.from.id`), а хранится строкой — как `chatId`:
 * идентификаторы Telegram не участвуют в арифметике и растут со временем.
 */
export async function ensureOwner(
  prisma: PrismaClient,
  telegramUserId: number,
  name?: string,
): Promise<string> {
  const key = String(telegramUserId);
  const owner = await prisma.owner.upsert({
    where: { telegramUserId: key },
    create: { telegramUserId: key, name: name ?? null },
    update: name === undefined ? {} : { name },
    select: { id: true },
  });
  return owner.id;
}

/** Владелец по Telegram user id, или `null`. Основа гейта доступа в 14b. */
export async function findOwnerByTelegramId(
  prisma: PrismaClient,
  telegramUserId: number,
): Promise<OwnerRecord | null> {
  return prisma.owner.findUnique({
    where: { telegramUserId: String(telegramUserId) },
    select: { id: true, telegramUserId: true, name: true },
  });
}

/** Строка экрана «👤 Владельцы» (Шаг 14b-4): владелец + сколько каналов он ведёт. */
export interface OwnerListEntry extends OwnerRecord {
  readonly channelCount: number;
}

/**
 * Список всех владельцев для экрана «👤 Владельцы» (Шаг 14b-4) — со счётчиком
 * каналов, чтобы супервладелец видел, что стоит за отзывом доступа.
 *
 * Порядок — по дате появления (старые сверху): экран адресует владельца ИНДЕКСОМ
 * в этом списке (протокол callback-data), поэтому сортировка должна быть
 * детерминированной, а не «как отдала БД».
 */
export async function listOwners(
  prisma: PrismaClient,
): Promise<OwnerListEntry[]> {
  const rows = await prisma.owner.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      telegramUserId: true,
      name: true,
      _count: { select: { channels: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    telegramUserId: r.telegramUserId,
    name: r.name,
    channelCount: r._count.channels,
  }));
}

/**
 * ОТЗЫВ ДОСТУПА (Шаг 14b-4): удаляет строку `Owner`. Возвращает `false`, если
 * такого владельца уже нет (гонка двух нажатий) — вызывающий тогда просто
 * перерисовывает список.
 *
 * Каналы при этом НЕ пропадают: `Channel.ownerId` объявлен `onDelete: SetNull`,
 * поэтому они становятся бесхозными, а ближайший старт вернёт их супервладельцу
 * через `claimOrphanChannels`. Это и есть нужное поведение: доступ к каналу
 * теряет только отозванный, контент и расписание остаются.
 *
 * ⚠️ Проверку «кому отзывать вообще можно» делает `canRevokeOwner` (ядро) —
 * репозиторий её не дублирует.
 */
export async function removeOwner(
  prisma: PrismaClient,
  ownerId: string,
): Promise<boolean> {
  const result = await prisma.owner.deleteMany({ where: { id: ownerId } });
  return result.count > 0;
}

/**
 * БЭКОФИЛЛ (Шаг 14a): отдаёт супервладельцу все каналы без владельца и возвращает
 * их число. Идемпотентно — берёт только `ownerId IS NULL`, поэтому чужие каналы
 * (появятся в 14b) не трогает, а повторный прогон ничего не делает.
 *
 * Зачем при каждом старте, а не разовым скриптом: прод на Railway поднимается через
 * `npm start` без ручных шагов, а `createChannel` (8a) владельца пока не штампует
 * (это работа 14b). Самоисцеление — тот же приём, что `ensureCampaignStart` (11a).
 */
export async function claimOrphanChannels(
  prisma: PrismaClient,
  ownerId: string,
): Promise<number> {
  const result = await prisma.channel.updateMany({
    where: { ownerId: null },
    data: { ownerId },
  });
  return result.count;
}
