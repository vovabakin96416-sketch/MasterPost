import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePosts,
  rawPostsSchema,
  toPostSeed,
} from "../src/core/content/postSchema";
import { parseTextPools } from "../src/core/content/textPoolSchema";

function readData(relativePath: string): unknown {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8"));
}

const rawContent = readData("../src/seed/data/content.json");
const rawTexts = readData("../src/seed/data/texts.json");

describe("content.json (посты канала №1)", () => {
  it("содержит ровно 32 поста и парсится схемой", () => {
    const raw = rawPostsSchema.parse(rawContent);
    expect(raw).toHaveLength(32);
  });

  it("id уникальны и покрывают 1..32", () => {
    const raw = rawPostsSchema.parse(rawContent);
    const ids = raw.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it("инвариант по interactive_type: keyword/choices/button на месте", () => {
    const raw = rawPostsSchema.parse(rawContent);
    for (const p of raw) {
      switch (p.interactive_type) {
        case "keyword_trigger":
          expect(p.keyword).not.toBeNull();
          break;
        case "button_choice":
          expect(p.choices).not.toBeNull();
          expect(p.choices?.length ?? 0).toBeGreaterThan(0);
          break;
        case "button_prediction":
          expect(p.button).not.toBeNull();
          break;
        case "vote_123":
          expect(p.reactions.length).toBeGreaterThan(0);
          break;
      }
    }
  });

  it("toPostSeed мапит snake_case → camelCase", () => {
    const first = rawPostsSchema.parse(rawContent)[0];
    expect(first).toBeDefined();
    if (!first) return;
    const seed = toPostSeed(first);
    expect(seed.externalId).toBe(first.id);
    expect(seed.interactiveType).toBe(first.interactive_type);
    expect(seed.pexelsQuery).toBe(first.pexels_query);
    expect(seed.photoPath).toBe(first.photo_path);
  });

  it("parsePosts возвращает 32 поста под БД", () => {
    expect(parsePosts(rawContent)).toHaveLength(32);
  });
});

describe("texts.json (пулы предсказаний канала №1)", () => {
  const expectedKeys = [
    "karta",
    "kofe",
    "runa",
    "button_love",
    "button_money",
    "button_cards",
  ];

  it("содержит ровно 6 ожидаемых ключей", () => {
    const pools = parseTextPools(rawTexts);
    const keys = pools.map((p) => p.key).sort();
    expect(keys).toEqual([...expectedKeys].sort());
  });

  it("каждый пул — непустой массив строк", () => {
    const pools = parseTextPools(rawTexts);
    for (const pool of pools) {
      expect(pool.texts.length).toBeGreaterThan(0);
      for (const text of pool.texts) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});
