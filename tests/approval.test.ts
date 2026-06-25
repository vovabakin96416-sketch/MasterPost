import { describe, expect, it } from "vitest";
import {
  AP_PREFIX,
  decodeApproval,
  encodeApproval,
  type ApprovalAction,
} from "../src/core/approval/callback";
import { buildApprovalCaption } from "../src/core/approval/caption";

const ACTIONS: readonly ApprovalAction[] = [
  "pub",
  "edit",
  "skip",
  "cancel",
  "reroll",
  "own",
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
