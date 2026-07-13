import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import {
  applyExperimentWinner,
  resolveAiGeneration,
} from "../src/services/experiments/optimizationService";
import type { PrismaClient } from "../src/db/client";

const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

/**
 * Фейковый Prisma для optimizationService: нет активного эксперимента, настройки
 * (`learned_strategy` / `strategy_apply_counter`) отдаются из подготовленной карты.
 * Записи `setting.upsert` складываем, чтобы проверить инкремент счётчика.
 */
function fakePrisma(settings: Record<string, unknown>): {
  prisma: PrismaClient;
  saved: Record<string, unknown>;
} {
  const saved: Record<string, unknown> = {};
  const prisma = {
    experiment: {
      findFirst: vi.fn(async () => null),
    },
    setting: {
      findUnique: vi.fn(async (args: { where: { channelId_key: { key: string } } }) => {
        const key = args.where.channelId_key.key;
        return key in settings ? { value: settings[key] } : null;
      }),
      upsert: vi.fn(async (args: { where: { channelId_key: { key: string } }; create: { value: unknown } }) => {
        saved[args.where.channelId_key.key] = args.create.value;
        return undefined;
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, saved };
}

const LEARNED = [
  { dimension: "media", variantKey: "with_photo", learnedAt: new Date().toISOString() },
];

describe("resolveAiGeneration (Шаг 13e)", () => {
  it("не разведочный пост (счётчик 0) → подмешивает директиву выученной стратегии", async () => {
    const { prisma, saved } = fakePrisma({
      learned_strategy: LEARNED,
      strategy_apply_counter: 0,
    });
    const result = await resolveAiGeneration(
      { prisma, logger: silentLogger },
      "c1",
    );
    expect(result.variantKey).toBeNull(); // активного эксперимента нет
    expect(result.variantDirective ?? "").not.toBe("");
    expect(saved.strategy_apply_counter).toBe(1); // счётчик увеличен
  });

  it("разведочный пост (счётчик 3) → стратегию НЕ применяет", async () => {
    const { prisma } = fakePrisma({
      learned_strategy: LEARNED,
      strategy_apply_counter: 3,
    });
    const result = await resolveAiGeneration(
      { prisma, logger: silentLogger },
      "c1",
    );
    expect(result.variantDirective).toBeNull();
  });
});

describe("applyExperimentWinner (Шаг 13e)", () => {
  it("нет активного эксперимента → no_experiment (стратегия не меняется)", async () => {
    const { prisma, saved } = fakePrisma({});
    const result = await applyExperimentWinner(prisma, "c1", new Date());
    expect(result.status).toBe("no_experiment");
    expect(saved.learned_strategy).toBeUndefined();
  });
});
