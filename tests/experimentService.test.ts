import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { assignExperimentVariant } from "../src/services/experiments/experimentService";
import type { PrismaClient } from "../src/db/client";
import type { ExperimentRow } from "../src/db/repositories/experimentRepository";

/** Тихий логгер-заглушка (как в growthNarrative.test.ts). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

/** Активный эксперимент по измерению с заданным счётчиком уже назначенных вариантов. */
function experiment(dimension: string, assignedCount = 0): ExperimentRow {
  return {
    id: "exp1",
    channelId: "c1",
    dimension,
    status: "active",
    assignedCount,
    startedAt: new Date("2026-07-13T00:00:00Z"),
    stoppedAt: null,
  };
}

/**
 * Фейковый Prisma: `findFirst` отдаёт заданный эксперимент, `update` атомарно
 * инкрементит счётчик и возвращает новое значение (как реальный `increment`).
 */
function fakePrisma(active: ExperimentRow | null): {
  prisma: PrismaClient;
  updateCalls: () => number;
} {
  let stored = active?.assignedCount ?? 0;
  let updateCalls = 0;
  const prisma = {
    experiment: {
      findFirst: vi.fn(async () => active),
      update: vi.fn(async () => {
        updateCalls += 1;
        stored += 1;
        return { assignedCount: stored };
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, updateCalls: () => updateCalls };
}

describe("assignExperimentVariant (Шаг 13b/13c)", () => {
  it("нет активного эксперимента → null, счётчик не двигаем", async () => {
    const { prisma, updateCalls } = fakePrisma(null);
    const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
    expect(result).toBeNull();
    expect(updateCalls()).toBe(0);
  });

  it("ротация: index 0 → первый вариант, 1 → второй, 2 → снова первый", async () => {
    const dims: Array<[number, string]> = [
      [0, "question"],
      [1, "action"],
      [2, "question"],
      [3, "action"],
    ];
    for (const [assignedCount, expected] of dims) {
      const { prisma } = fakePrisma(experiment("cta_style", assignedCount));
      const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
      expect(result?.variantKey).toBe(expected);
    }
  });

  it("вместе с ключом отдаёт непустую директиву варианта для промпта (13c)", async () => {
    const { prisma } = fakePrisma(experiment("cta_style", 0));
    const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
    expect(result?.variantKey).toBe("question");
    expect((result?.directive ?? "").length).toBeGreaterThan(0);
  });

  it("другое измерение (media) отдаёт свои варианты", async () => {
    const { prisma } = fakePrisma(experiment("media", 0));
    const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
    expect(result?.variantKey).toBe("with_photo");
  });

  it("неизвестное измерение → null и НЕ двигаем счётчик ротации", async () => {
    const { prisma, updateCalls } = fakePrisma(experiment("unknown_dim", 0));
    const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
    expect(result).toBeNull();
    expect(updateCalls()).toBe(0);
  });

  it("ошибка БД глотается → null (не роняет публикацию)", async () => {
    const prisma = {
      experiment: {
        findFirst: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as unknown as PrismaClient;
    const result = await assignExperimentVariant({ prisma, logger: silentLogger }, "c1");
    expect(result).toBeNull();
  });
});
