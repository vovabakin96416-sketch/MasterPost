import { describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { Logger } from "pino";
import {
  BOT_ERROR_DECRYPT,
  LAST_ERROR_MAX_LENGTH,
  describeBotStartError,
  isClientBotUpdateAllowed,
  parseBotOwnerUserId,
} from "../src/core/bots/botStartup";
import {
  createOwnerBotRegistry,
  startStoredOwnerBots,
  type LaunchableBotAccount,
} from "../src/services/botRegistry";
import { encryptSecret } from "../src/core/security/tokenCipher";
import type { PrismaClient } from "../src/db/client";

const KEY = "test-encryption-key-1234567890";
const TOKEN = "8123456789:AAEhBOweik6ad9r_AbCdEfGhIjKlMnOpQrS";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

describe("describeBotStartError (Шаг 14b-bis-2)", () => {
  it("узнаёт отозванный токен (401)", () => {
    const text = describeBotStartError(
      new Error("Call to 'getMe' failed! (401: Unauthorized)"),
    );
    expect(text).toContain("401");
    expect(text).toContain("BotFather");
  });

  it("узнаёт второй long polling (409)", () => {
    const text = describeBotStartError(new Error("409: Conflict: terminated by other getUpdates"));
    expect(text).toContain("409");
  });

  it("🔒 не выпускает токен в текст ошибки", () => {
    const text = describeBotStartError(new Error(`сеть отвалилась на ${TOKEN}`));
    expect(text).not.toContain("AAEhBOweik6ad9r");
    expect(text).toContain("<токен скрыт>");
  });

  it("обрезает длинную ошибку — строка идёт в сообщение Telegram", () => {
    const text = describeBotStartError(new Error("ы".repeat(500)));
    expect(text.length).toBeLessThanOrEqual(LAST_ERROR_MAX_LENGTH);
  });

  it("не падает на не-ошибке", () => {
    expect(describeBotStartError(undefined)).toContain("неизвестна");
  });
});

describe("parseBotOwnerUserId", () => {
  it("читает id владельца из строки БД", () => {
    expect(parseBotOwnerUserId("7035079048")).toBe(7035079048);
  });

  it.each(["", "abc", "-1", "0", "1e999"])("отклоняет мусор: %s", (raw) => {
    expect(parseBotOwnerUserId(raw)).toBeNull();
  });
});

describe("isClientBotUpdateAllowed (🔒 бот клиента — только своему владельцу)", () => {
  it("пускает владельца в личку", () => {
    expect(isClientBotUpdateAllowed("private", 100, 100)).toBe(true);
  });

  it("НЕ пускает постороннего в личку — чужое меню через чужой токен", () => {
    expect(isClientBotUpdateAllowed("private", 200, 100)).toBe(false);
  });

  it("пускает апдейты канала и обсуждения — их шлют подписчики", () => {
    expect(isClientBotUpdateAllowed("channel", 200, 100)).toBe(true);
    expect(isClientBotUpdateAllowed("supergroup", 200, 100)).toBe(true);
    expect(isClientBotUpdateAllowed(undefined, undefined, 100)).toBe(true);
  });
});

/** Фейковый grammY-бот: реестру нужны только `catch`/`start`/`stop`/`api`. */
function fakeBot(options?: { readonly startFails?: Error }) {
  const stop = vi.fn(async () => undefined);
  const api = { setMyCommands: vi.fn(async () => true) };
  let resolveStart: (() => void) | undefined;
  const start = vi.fn(async (opts?: { onStart?: (info: { username: string }) => void }) => {
    if (options?.startFails !== undefined) {
      throw options.startFails;
    }
    opts?.onStart?.({ username: "client_bot" });
    // Настоящий `bot.start()` не резолвится, пока бот работает.
    await new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
  });
  const bot = { catch: vi.fn(), start, stop, api } as unknown as Bot;
  return { bot, start, stop, api, finish: () => resolveStart?.() };
}

/** Фейковый Prisma: копит, что реестр записал в `BotAccount`. */
function fakePrisma() {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const prisma = {
    botAccount: {
      updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, updates };
}

function account(overrides?: Partial<LaunchableBotAccount>): LaunchableBotAccount {
  return {
    ownerId: "owner-1",
    botUserId: "8123456789",
    username: "client_bot",
    tokenCipher: encryptSecret(TOKEN, KEY),
    ownerTelegramUserId: "555",
    ...overrides,
  };
}

describe("createOwnerBotRegistry (мультибот в одном процессе, Шаг 14b-bis-2)", () => {
  it("поднимает бота владельца и отдаёт его Api для маршрутизации", async () => {
    const { prisma, updates } = fakePrisma();
    const built = fakeBot();
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: (token, ownerUserId) => {
        expect(token).toBe(TOKEN); // расшифровался ровно тот токен
        expect(ownerUserId).toBe(555);
        return built.bot;
      },
    });

    await registry.launch(account());

    expect(registry.size()).toBe(1);
    expect(registry.getApi("owner-1")).toBe(built.api);
    expect(built.start).toHaveBeenCalled();
    // Удачный старт снимает прошлую ошибку с экрана «🤖 Мой бот».
    await vi.waitFor(() =>
      expect(updates.some((u) => u.data["lastError"] === null)).toBe(true),
    );
    built.finish();
  });

  it("битый шифротекст не роняет запуск — только причина в lastError", async () => {
    const { prisma, updates } = fakePrisma();
    const buildBot = vi.fn(() => fakeBot().bot);
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot,
    });

    await registry.launch(account({ tokenCipher: "v1:ff:ff:ff" }));

    expect(buildBot).not.toHaveBeenCalled();
    expect(registry.size()).toBe(0);
    expect(updates[0]?.data["lastError"]).toBe(BOT_ERROR_DECRYPT);
    // ⚠️ Аккаунт не гасим: следующий старт процесса попробует снова.
    expect(updates[0]?.data["isActive"]).toBeUndefined();
  });

  it("падение long polling убирает бота из реестра и объясняет причину", async () => {
    const { prisma, updates } = fakePrisma();
    const built = fakeBot({ startFails: new Error("401: Unauthorized") });
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: () => built.bot,
    });

    await registry.launch(account());

    await vi.waitFor(() => expect(registry.size()).toBe(0));
    expect(registry.getApi("owner-1")).toBeUndefined();
    await vi.waitFor(() =>
      expect(updates.some((u) => String(u.data["lastError"]).includes("401"))).toBe(true),
    );
  });

  it("замена токена гасит прежнего бота владельца", async () => {
    const { prisma } = fakePrisma();
    const first = fakeBot();
    const second = fakeBot();
    const bots = [first, second];
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: () => (bots.shift() ?? first).bot,
    });

    await registry.launch(account());
    await registry.launch(account());

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
    expect(registry.getApi("owner-1")).toBe(second.api);
    first.finish();
    second.finish();
  });

  it("отключение бота гасит его сразу, а stopAll — всех", async () => {
    const { prisma } = fakePrisma();
    const a = fakeBot();
    const b = fakeBot();
    const bots = [a, b];
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: () => (bots.shift() ?? a).bot,
    });
    await registry.launch(account());
    await registry.launch(account({ ownerId: "owner-2" }));

    await registry.stop("owner-1");
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(registry.getApi("owner-1")).toBeUndefined();
    expect(registry.size()).toBe(1);

    await registry.stopAll();
    expect(b.stop).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it("без ключа шифрования ботов не поднимает и владельца не обвиняет", async () => {
    const { prisma, updates } = fakePrisma();
    const buildBot = vi.fn(() => fakeBot().bot);
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: undefined,
      buildBot,
    });

    await registry.launch(account());

    expect(buildBot).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0); // это проблема env, а не токена клиента
  });

  it("нечитаемый Telegram-id владельца — бот не поднимается", async () => {
    const { prisma, updates } = fakePrisma();
    const buildBot = vi.fn(() => fakeBot().bot);
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot,
    });

    await registry.launch(account({ ownerTelegramUserId: "не число" }));

    expect(buildBot).not.toHaveBeenCalled();
    expect(updates[0]?.data["lastError"]).toContain("Telegram-id");
  });
});

describe("startStoredOwnerBots", () => {
  it("сбой чтения БД не мешает старту главного бота", async () => {
    const prisma = {
      botAccount: {
        findMany: vi.fn(async () => {
          throw new Error("БД недоступна");
        }),
      },
    } as unknown as PrismaClient;
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: () => fakeBot().bot,
    });

    await expect(
      startStoredOwnerBots(registry, prisma, silentLogger),
    ).resolves.toBe(0);
  });

  it("поднимает всех включённых владельцев", async () => {
    const rows = [
      {
        id: "a",
        ownerId: "owner-1",
        botUserId: "1",
        username: "one",
        tokenCipher: encryptSecret(TOKEN, KEY),
        isActive: true,
        lastError: null,
        createdAt: new Date(),
        owner: { telegramUserId: "555" },
      },
    ];
    const prisma = {
      botAccount: {
        findMany: vi.fn(async () => rows),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaClient;
    const built = fakeBot();
    const registry = createOwnerBotRegistry({
      prisma,
      logger: silentLogger,
      botTokenEncKey: KEY,
      buildBot: () => built.bot,
    });

    await expect(
      startStoredOwnerBots(registry, prisma, silentLogger),
    ).resolves.toBe(1);
    expect(registry.size()).toBe(1);
    built.finish();
  });
});
