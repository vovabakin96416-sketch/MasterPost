import { describe, expect, it } from "vitest";
import { maskBotToken, validateBotToken } from "../src/core/menu/botToken";
import {
  CIPHER_VERSION,
  decryptSecret,
  encryptSecret,
} from "../src/core/security/tokenCipher";

/** Правдоподобный токен BotFather (выдуманный) — форма важнее конкретных символов. */
const TOKEN = "8123456789:AAEhBOweik6ad9r_AbCdEfGhIjKlMnOpQrS";
const KEY = "test-encryption-key-1234567890";

describe("validateBotToken (форма токена, Шаг 14b-bis-1)", () => {
  it("принимает токен и достаёт из него id бота", () => {
    const result = validateBotToken(TOKEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token).toBe(TOKEN);
    expect(result.value.botUserId).toBe("8123456789");
  });

  it("режет пробелы и переводы строк при копировании из BotFather", () => {
    const result = validateBotToken(`  ${TOKEN}\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token).toBe(TOKEN);
  });

  it.each([
    ["пусто", "   "],
    ["@username вместо токена", "@my_cool_bot"],
    ["ссылка на бота", "https://t.me/my_cool_bot"],
    ["без секретной части", "8123456789:"],
    ["слишком короткий секрет", "8123456789:AAEhBOweik6ad9r"],
    ["без id", ":AAEhBOweik6ad9r_AbCdEfGhIjKlMnOpQrS"],
    ["лишний текст рядом", `вот мой токен ${TOKEN}`],
  ])("отклоняет: %s", (_name, input) => {
    expect(validateBotToken(input).ok).toBe(false);
  });
});

describe("maskBotToken", () => {
  it("прячет секрет, оставляя id и хвост", () => {
    const masked = maskBotToken(TOKEN);
    expect(masked).toContain("8123456789:");
    expect(masked).not.toContain("AAEhBOweik6ad9r");
    expect(masked.endsWith("OpQrS".slice(-4))).toBe(true);
  });

  it("не падает на строке без разделителя", () => {
    expect(maskBotToken("мусор")).not.toContain("мусор");
  });
});

describe("tokenCipher (шифрование секретов, Шаг 14b-bis-1)", () => {
  it("расшифровывает то, что зашифровал", () => {
    expect(decryptSecret(encryptSecret(TOKEN, KEY), KEY)).toBe(TOKEN);
  });

  it("не хранит секрет в открытом виде и помечает версию формата", () => {
    const payload = encryptSecret(TOKEN, KEY);
    expect(payload).not.toContain(TOKEN);
    expect(payload.startsWith(`${CIPHER_VERSION}:`)).toBe(true);
  });

  it("даёт разный шифротекст при каждом вызове (свой iv)", () => {
    expect(encryptSecret(TOKEN, KEY)).not.toBe(encryptSecret(TOKEN, KEY));
  });

  it("возвращает null на другом ключе — а не мусор вместо токена", () => {
    expect(decryptSecret(encryptSecret(TOKEN, KEY), "другой-ключ-1234567890")).toBe(
      null,
    );
  });

  it("возвращает null на подменённом шифротексте (GCM ловит правку)", () => {
    const payload = encryptSecret(TOKEN, KEY);
    const parts = payload.split(":");
    const data = parts[3] ?? "";
    const tampered = `${data.slice(0, -2)}${data.endsWith("00") ? "11" : "00"}`;
    expect(decryptSecret([...parts.slice(0, 3), tampered].join(":"), KEY)).toBe(null);
  });

  it.each([
    ["чужой формат", "просто строка"],
    ["незнакомая версия", "v9:aa:bb:cc"],
    ["не хватает частей", "v1:aa:bb"],
  ])("возвращает null: %s", (_name, payload) => {
    expect(decryptSecret(payload, KEY)).toBe(null);
  });
});
