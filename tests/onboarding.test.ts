import { describe, expect, it, vi } from "vitest";
import { Context, type Api } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Logger } from "pino";
import {
  classifyBotMembership,
  evaluateChannelRights,
  extractRights,
} from "../src/core/onboarding/membership";
import { createOnboardingComposer } from "../src/telegram/features/onboarding";

describe("classifyBotMembership", () => {
  it("member → administrator = promoted", () => {
    expect(classifyBotMembership("member", "administrator")).toBe("promoted");
  });

  it("left → creator = promoted (добавили сразу владельцем)", () => {
    expect(classifyBotMembership("left", "creator")).toBe("promoted");
  });

  it("administrator → member = demoted", () => {
    expect(classifyBotMembership("administrator", "member")).toBe("demoted");
  });

  it("administrator → kicked = removed (уход важнее, чем потеря админки)", () => {
    expect(classifyBotMembership("administrator", "kicked")).toBe("removed");
  });

  it("member → left = removed", () => {
    expect(classifyBotMembership("member", "left")).toBe("removed");
  });

  it("administrator → administrator = unchanged (правки прав не онбординг)", () => {
    expect(classifyBotMembership("administrator", "administrator")).toBe(
      "unchanged",
    );
  });
});

describe("extractRights", () => {
  it("администратор с правом публикации", () => {
    expect(extractRights("administrator", true)).toEqual({
      isAdmin: true,
      canPost: true,
    });
  });

  it("администратор без права публикации", () => {
    expect(extractRights("administrator", false)).toEqual({
      isAdmin: true,
      canPost: false,
    });
  });

  it("администратор с неизвестным правом (undefined) → не может публиковать", () => {
    expect(extractRights("administrator", undefined)).toEqual({
      isAdmin: true,
      canPost: false,
    });
  });

  it("владелец имеет все права независимо от can_post_messages", () => {
    expect(extractRights("creator", undefined)).toEqual({
      isAdmin: true,
      canPost: true,
    });
  });

  it("обычный участник — не админ, не может публиковать", () => {
    expect(extractRights("member", undefined)).toEqual({
      isAdmin: false,
      canPost: false,
    });
  });
});

describe("evaluateChannelRights", () => {
  it("админ с публикацией → прав достаточно, ничего не недостаёт", () => {
    const report = evaluateChannelRights({ isAdmin: true, canPost: true });
    expect(report.missing).toEqual([]);
    expect(report.canPost).toBe(true);
    expect(report.summary).toContain("✅");
  });

  it("админ без публикации → недостаёт право публиковать", () => {
    const report = evaluateChannelRights({ isAdmin: true, canPost: false });
    expect(report.missing).toContain("право публиковать сообщения");
    expect(report.summary).toContain("⚠️");
  });

  it("не админ → недостаёт права администратора", () => {
    const report = evaluateChannelRights({ isAdmin: false, canPost: false });
    expect(report.isAdmin).toBe(false);
    expect(report.missing).toContain("права администратора");
  });
});

describe("композер онбординга: регистрирует канал только от зарегистрированного владельца", () => {
  // Гейт 14b-1: доступ по таблице Owner, а не по единственному ADMIN_ID.
  const OWNER_TG_ID = 42;
  const OWNER_ROW_ID = "own1";

  const silentLogger = {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
  } as unknown as Logger;

  const botUser = { id: 999, is_bot: true, first_name: "Bot", username: "mp_bot" };

  /** Апдейт «бота повысили до админа канала»; `fromId` — кто менял права. */
  function promotedUpdate(fromId: number): Update {
    return {
      update_id: 1,
      my_chat_member: {
        chat: { id: -100555, type: "channel", title: "Канал" },
        from: { id: fromId, is_bot: false, first_name: "Юзер" },
        date: 1,
        old_chat_member: { user: botUser, status: "left" },
        new_chat_member: {
          user: botUser,
          status: "administrator",
          can_post_messages: true,
        },
      },
    } as unknown as Update;
  }

  /** Прогоняет апдейт через композер с моками БД/API; возвращает моки для проверок. */
  async function run(
    fromId: number,
    // Тариф владельца (14e): по умолчанию бессрочный — как строка, созданная до 14e.
    plan: { plan: "trial" | "active"; trialUntil: Date | null } = {
      plan: "active",
      trialUntil: null,
    },
  ): Promise<{
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  }> {
    // Owner в реестре один — OWNER_TG_ID; остальные не зарегистрированы.
    const ownerFindUnique = vi.fn().mockImplementation(
      ({ where }: { where: { telegramUserId: string } }) =>
        Promise.resolve(
          where.telegramUserId === String(OWNER_TG_ID)
            ? {
                id: OWNER_ROW_ID,
                telegramUserId: where.telegramUserId,
                name: null,
                ...plan,
              }
            : null,
        ),
    );
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "c1" });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const composer = createOnboardingComposer({
      prisma: {
        owner: { findUnique: ownerFindUnique },
        channel: { findFirst, create },
      } as never,
      logger: silentLogger,
      adminId: 7035079048, // супервладелец — не OWNER_TG_ID
    });
    const ctx = new Context(
      promotedUpdate(fromId),
      { sendMessage } as unknown as Api,
      botUser as unknown as UserFromGetMe,
    );
    await composer.middleware()(ctx, () => Promise.resolve());
    return { findFirst, create, sendMessage };
  }

  it("зарегистрированный владелец добавил бота → канал со штампом владельца, ему ушёл DM", async () => {
    const { create, sendMessage } = await run(OWNER_TG_ID);
    expect(create).toHaveBeenCalledTimes(1);
    const createArgs = create.mock.calls[0][0] as { data: { ownerId: string } };
    expect(createArgs.data.ownerId).toBe(OWNER_ROW_ID);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(OWNER_TG_ID);
    expect(String(sendMessage.mock.calls[0][1])).toContain("подключён");
  });

  it("владелец с истёкшим триалом → канал НЕ регистрируется (обход гейта 14e)", async () => {
    const { create, sendMessage } = await run(OWNER_TG_ID, {
      plan: "trial",
      trialUntil: new Date(Date.now() - 60_000),
    });
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("владелец с действующим триалом подключает канал как обычно", async () => {
    const { create } = await run(OWNER_TG_ID, {
      plan: "trial",
      trialUntil: new Date(Date.now() + 60_000),
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("незарегистрированный человек добавил бота → игнор: ни записи в БД, ни DM", async () => {
    const { findFirst, create, sendMessage } = await run(777);
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
