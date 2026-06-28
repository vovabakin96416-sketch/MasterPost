import { describe, expect, it } from "vitest";
import { pickSelectedId } from "../src/core/menu/selectChannel.js";

describe("pickSelectedId", () => {
  const channels = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("возвращает запомненный канал, если он есть в списке", () => {
    expect(pickSelectedId("b", channels)).toBe("b");
  });

  it("падает на первый канал, если выбор не задан", () => {
    expect(pickSelectedId(undefined, channels)).toBe("a");
  });

  it("падает на первый канал, если выбранного уже нет (удалён)", () => {
    expect(pickSelectedId("z", channels)).toBe("a");
  });

  it("возвращает null, если каналов нет вовсе", () => {
    expect(pickSelectedId("a", [])).toBeNull();
    expect(pickSelectedId(undefined, [])).toBeNull();
  });
});
