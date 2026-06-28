import { describe, expect, it } from "vitest";
import {
  classifyBotMembership,
  evaluateChannelRights,
  extractRights,
} from "../src/core/onboarding/membership";

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
