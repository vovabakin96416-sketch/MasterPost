import { describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import type { Logger } from "pino";
import { routeChannel, sendVia } from "../src/services/botRouting";
import type { OwnerBotRegistry } from "../src/services/botRegistry";
import type { PrismaClient } from "../src/db/client";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const mainApi = { name: "main" } as unknown as Api;
const ownerApi = { name: "owner" } as unknown as Api;

/** Prisma, отдающий владельца канала (или роняющий запрос). */
function fakePrisma(ownerId: string | null, fails = false): PrismaClient {
  return {
    channel: {
      findUnique: vi.fn(async () => {
        if (fails) {
          throw new Error("БД недоступна");
        }
        return { ownerId };
      }),
    },
  } as unknown as PrismaClient;
}

function fakeRegistry(apis: Record<string, Api>): OwnerBotRegistry {
  return {
    launch: async () => undefined,
    stop: async () => undefined,
    getApi: (ownerId: string) => apis[ownerId],
    setMainApi: () => undefined,
    getMainApi: () => mainApi,
    size: () => Object.keys(apis).length,
    stopAll: async () => undefined,
  };
}

describe("routeChannel (Шаг 14b-bis-3 — каким ботом писать)", () => {
  it("канал владельца с подключённым ботом ведёт ЕГО бот, страховка — общий", async () => {
    const routed = await routeChannel(
      {
        prisma: fakePrisma("owner-1"),
        logger: silentLogger,
        api: mainApi,
        ownerBots: fakeRegistry({ "owner-1": ownerApi }),
      },
      "ch-1",
    );
    expect(routed.api).toBe(ownerApi);
    expect(routed.fallbackApi).toBe(mainApi);
  });

  it("владелец без своего бота — как раньше, общим ботом и без лишней страховки", async () => {
    const routed = await routeChannel(
      {
        prisma: fakePrisma("owner-1"),
        logger: silentLogger,
        api: mainApi,
        ownerBots: fakeRegistry({}),
      },
      "ch-1",
    );
    expect(routed.api).toBe(mainApi);
    // Повтор тем же ботом бессмыслен — только удвоил бы ту же ошибку.
    expect(routed.fallbackApi).toBeUndefined();
  });

  it("канал без владельца ведёт общий бот", async () => {
    const routed = await routeChannel(
      {
        prisma: fakePrisma(null),
        logger: silentLogger,
        api: mainApi,
        ownerBots: fakeRegistry({ "owner-1": ownerApi }),
      },
      "ch-1",
    );
    expect(routed.api).toBe(mainApi);
  });

  it("без реестра ничего не меняется (мультибот не собран)", async () => {
    const deps = {
      prisma: fakePrisma("owner-1"),
      logger: silentLogger,
      api: mainApi,
    };
    expect(await routeChannel(deps, "ch-1")).toBe(deps);
  });

  it("сбой БД не роняет публикацию — пишем как раньше", async () => {
    const deps = {
      prisma: fakePrisma("owner-1", true),
      logger: silentLogger,
      api: mainApi,
      ownerBots: fakeRegistry({ "owner-1": ownerApi }),
    };
    const routed = await routeChannel(deps, "ch-1");
    expect(routed.api).toBe(mainApi);
    expect(routed.fallbackApi).toBeUndefined();
  });
});

describe("sendVia (фолбэк на общего бота)", () => {
  it("удачную отправку не дублирует", async () => {
    const action = vi.fn(async () => "ok");
    const result = await sendVia(
      { logger: silentLogger, api: ownerApi, fallbackApi: mainApi },
      action,
    );
    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(ownerApi);
  });

  it("бот клиента не смог (не админ в канале / 403 в личке) → повтор общим", async () => {
    const action = vi.fn(async (api: Api) => {
      if (api === ownerApi) {
        throw new Error("403: bot is not a member of the channel chat");
      }
      return "ok";
    });
    const result = await sendVia(
      { logger: silentLogger, api: ownerApi, fallbackApi: mainApi },
      action,
    );
    expect(result).toBe("ok");
    expect(action).toHaveBeenNthCalledWith(2, mainApi);
  });

  it("без страховки ошибку отдаёт вызывающему (его деградации не ломаем)", async () => {
    const action = vi.fn(async () => {
      throw new Error("Bad Request: can't parse entities");
    });
    await expect(
      sendVia({ logger: silentLogger, api: mainApi }, action),
    ).rejects.toThrow("parse entities");
    expect(action).toHaveBeenCalledTimes(1);
  });
});
