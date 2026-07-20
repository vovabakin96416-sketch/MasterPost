import { describe, expect, it } from "vitest";
import {
  AP_PREFIX,
  decodeApproval,
  encodeApproval,
  type ApprovalAction,
} from "../src/core/approval/callback";
import { buildApprovalCaption } from "../src/core/approval/caption";
import { canActOnChannel, resolveOwnerTarget } from "../src/core/approval/access";

const ACTIONS: readonly ApprovalAction[] = [
  "pub",
  "edit",
  "skip",
  "cancel",
  "reroll",
  "own",
  "preview",
];

describe("approval callback: encode/decode round-trip", () => {
  it("кодирует и декодирует действие с id", () => {
    const data = encodeApproval("pub", "abc123");
    expect(data).toBe(`${AP_PREFIX}:pub:abc123`);
    expect(decodeApproval(data)).toEqual({ action: "pub", id: "abc123" });
  });

  it("все действия round-trip", () => {
    for (const action of ACTIONS) {
      expect(decodeApproval(encodeApproval(action, "xyz"))).toEqual({
        action,
        id: "xyz",
      });
    }
  });

  it("чужой префикс / неизвестное действие / пустой id → null", () => {
    expect(decodeApproval("m:home")).toBeNull(); // префикс меню
    expect(decodeApproval("ap:pub")).toBeNull(); // нет id
    expect(decodeApproval("ap:bogus:id")).toBeNull(); // неизвестное действие
    expect(decodeApproval("ap:pub:")).toBeNull(); // пустой id
    expect(decodeApproval("")).toBeNull();
  });

  it("callback с cuid-id помещается в лимит 64 байта", () => {
    const id = `c${"a".repeat(24)}`; // cuid ~25 символов
    for (const action of ACTIONS) {
      const data = encodeApproval(action, id);
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("buildApprovalCaption", () => {
  const snap = { title: "Заголовок", text: "Тело поста", cta: "Жми сюда" };

  it("содержит пост и цель публикации", () => {
    const caption = buildApprovalCaption(snap, "@supertestmaster");
    expect(caption).toContain("Заголовок");
    expect(caption).toContain("Тело поста");
    expect(caption).toContain("Жми сюда");
    expect(caption).toContain("@supertestmaster");
    expect(caption).toContain("Одобри публикацию");
  });

  it("без цели — предупреждение «не задан»", () => {
    expect(buildApprovalCaption(snap, null)).toContain("не задан");
  });
});

describe("resolveOwnerTarget: адресат уведомлений канала (Шаг 14b-2)", () => {
  const SUPER = 42;

  it("владелец канала задан → уведомления ему, не супервладельцу", () => {
    expect(resolveOwnerTarget("777", SUPER)).toBe(777);
  });

  it("канал без владельца → супервладелец", () => {
    expect(resolveOwnerTarget(null, SUPER)).toBe(SUPER);
  });

  it("мусор/0/отрицательный id в БД → супервладелец, а не падение Bot API", () => {
    for (const bad of ["", "не число", "0", "-5", "1.5", "9".repeat(30)]) {
      expect(resolveOwnerTarget(bad, SUPER)).toBe(SUPER);
    }
  });
});

describe("canActOnChannel: кнопки ap:* только своему каналу (Шаг 14b-2)", () => {
  const SUPER = 42;

  it("владелец жмёт свой пост → можно, чужой владелец → нельзя", () => {
    expect(canActOnChannel(777, "777", SUPER)).toBe(true);
    expect(canActOnChannel(888, "777", SUPER)).toBe(false);
  });

  it("супервладелец ведёт канал без владельца, но не лезет к чужому", () => {
    expect(canActOnChannel(SUPER, null, SUPER)).toBe(true);
    expect(canActOnChannel(SUPER, "777", SUPER)).toBe(false);
  });
});
