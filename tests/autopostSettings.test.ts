import { describe, expect, it, vi } from "vitest";
import {
  readAutopostConfig,
  toggleAiAutopost,
} from "../src/services/autopostSettings";
import type { PrismaClient } from "../src/db/client";

/**
 * 10c: тумблер AI-подхвата автопостинга. Настройки лежат в таблице `Setting`
 * (ключ `autopost_ai_enabled`); мокаем `prisma.setting` по образцу posting.test.
 */

/** Мок prisma.setting.findUnique по карте «ключ → значение». */
function makePrisma(settings: Record<string, unknown>): {
  prisma: PrismaClient;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    setting: {
      findUnique: vi.fn(({ where }: { where: { channelId_key: { key: string } } }) => {
        const value = settings[where.channelId_key.key];
        return Promise.resolve(value === undefined ? null : { value });
      }),
      upsert,
    },
  } as unknown as PrismaClient;
  return { prisma, upsert };
}

describe("readAutopostConfig: aiEnabled", () => {
  it("по умолчанию (нет записи) → aiEnabled=false", async () => {
    const { prisma } = makePrisma({});
    const config = await readAutopostConfig(prisma, "ch1");
    expect(config.aiEnabled).toBe(false);
  });

  it("ключ autopost_ai_enabled=true → aiEnabled=true", async () => {
    const { prisma } = makePrisma({ autopost_ai_enabled: true });
    const config = await readAutopostConfig(prisma, "ch1");
    expect(config.aiEnabled).toBe(true);
  });
});

describe("toggleAiAutopost", () => {
  it("из выкл (нет записи) → включает и возвращает true", async () => {
    const { prisma, upsert } = makePrisma({});
    const next = await toggleAiAutopost(prisma, "ch1");
    expect(next).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0] as { create: { key: string; value: unknown } };
    expect(arg.create.key).toBe("autopost_ai_enabled");
    expect(arg.create.value).toBe(true);
  });

  it("из вкл → выключает и возвращает false", async () => {
    const { prisma } = makePrisma({ autopost_ai_enabled: true });
    const next = await toggleAiAutopost(prisma, "ch1");
    expect(next).toBe(false);
  });
});
