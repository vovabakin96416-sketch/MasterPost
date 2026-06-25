import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { planPhoto } from "../src/core/media/resolvePriority";
import { providerFor, refToCacheString } from "../src/services/mediaService";
import { pexelsProvider } from "../src/services/media/pexelsProvider";
import { genProvider } from "../src/services/media/genProvider";

/** Тихий логгер-заглушка для провайдеров (без реального pino). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

describe("planPhoto: приоритет источника фото", () => {
  it("готовый photoUrl — высший приоритет", () => {
    expect(
      planPhoto({ photoUrl: "u", photoPath: "p", pexelsQuery: "q" }),
    ).toEqual({ kind: "ready", ref: { kind: "url", url: "u" } });
  });

  it("без url, но есть локальный путь → ready/path", () => {
    expect(planPhoto({ photoPath: "/img.jpg", pexelsQuery: "q" })).toEqual({
      kind: "ready",
      ref: { kind: "path", path: "/img.jpg" },
    });
  });

  it("есть только запрос → fetch", () => {
    expect(planPhoto({ pexelsQuery: "tarot moon" })).toEqual({
      kind: "fetch",
      query: "tarot moon",
    });
  });

  it("ничего нет (null/пустые строки) → none", () => {
    expect(planPhoto({})).toEqual({ kind: "none" });
    expect(planPhoto({ photoUrl: "", photoPath: "", pexelsQuery: "" })).toEqual({
      kind: "none",
    });
    expect(planPhoto({ photoUrl: null, photoPath: null, pexelsQuery: null })).toEqual({
      kind: "none",
    });
  });
});

describe("refToCacheString: что кэшируем в PendingPost.photoUrl", () => {
  it("url и file_id кэшируются строкой, путь — нет, null — null", () => {
    expect(refToCacheString({ kind: "url", url: "http://x" })).toBe("http://x");
    expect(refToCacheString({ kind: "fileId", fileId: "AgAC" })).toBe("AgAC");
    expect(refToCacheString({ kind: "path", path: "/img.jpg" })).toBeNull();
    expect(refToCacheString(null)).toBeNull();
  });
});

describe("providerFor: выбор провайдера по тарифу", () => {
  it("free → Pexels, paid → генерация", () => {
    expect(providerFor("free").name).toBe("pexels");
    expect(providerFor("paid").name).toBe("generation");
  });
});

describe("pexelsProvider.fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("без ключа → null (мягкая деградация, сеть не дёргаем)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const url = await pexelsProvider.fetch("q", { logger: silentLogger, apiKey: undefined });
    expect(url).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("успешный ответ → URL large из выдачи", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ photos: [{ src: { large: "http://pic/large.jpg" } }] }),
      }),
    );
    const url = await pexelsProvider.fetch("q", { logger: silentLogger, apiKey: "key" });
    expect(url).toBe("http://pic/large.jpg");
  });

  it("пустая выдача → null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ photos: [] }),
      }),
    );
    expect(
      await pexelsProvider.fetch("q", { logger: silentLogger, apiKey: "key" }),
    ).toBeNull();
  });

  it("ответ не 2xx → null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    );
    expect(
      await pexelsProvider.fetch("q", { logger: silentLogger, apiKey: "key" }),
    ).toBeNull();
  });

  it("ошибка сети → null (без исключения наружу)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(
      await pexelsProvider.fetch("q", { logger: silentLogger, apiKey: "key" }),
    ).toBeNull();
  });
});

describe("genProvider.fetch (заглушка платной генерации, Шаг 10)", () => {
  it("пока всегда null → откат на сток", async () => {
    expect(
      await genProvider.fetch("q", { logger: silentLogger, apiKey: undefined }),
    ).toBeNull();
  });
});
