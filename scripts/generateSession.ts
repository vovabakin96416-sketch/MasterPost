/**
 * generateSession.ts — запусти ОДИН РАЗ локально: `npm run gen-session`.
 *
 * Интерактивный вход под ЛИЧНЫМ аккаунтом (телефон → код → 2FA) → печатает строку
 * TELEGRAM_SESSION для вставки в переменные Railway. Порт `generate_session.py`.
 *
 * Тонкая обёртка: вся GramJS-логика — в типобезопасном `src/services/analytics/
 * mtprotoClient.ts`, здесь только readline-ввод. На сервере этот файл НЕ нужен.
 *
 * ⚠️ SESSION = полный доступ к аккаунту. НИКОГДА не коммить строку в git и не
 *    вставляй её в код — только в env Railway / локальный .env (он в .gitignore).
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createMtprotoClient,
  fetchSelfLabel,
  loginInteractive,
} from "../src/services/analytics/mtprotoClient.js";

// Подхватываем .env, чтобы api_id/api_hash можно было не вводить вручную.
try {
  process.loadEnvFile();
} catch {
  // .env может отсутствовать — тогда спросим всё в консоли.
}

/** Значение env или undefined, если пусто/не задано (чтобы спросить в консоли). */
function envOrUndefined(key: string): string | undefined {
  const value = process.env[key];
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Где взять api_id / api_hash: https://my.telegram.org → API development tools\n");

    const apiIdRaw =
      envOrUndefined("TELEGRAM_API_ID") ??
      (await rl.question("api_id (число): "));
    const apiHash =
      envOrUndefined("TELEGRAM_API_HASH") ?? (await rl.question("api_hash: "));

    const apiId = Number(apiIdRaw.trim());
    if (!Number.isInteger(apiId) || apiId <= 0) {
      console.error("❌ api_id должен быть положительным целым числом.");
      process.exitCode = 1;
      return;
    }

    const session = await loginInteractive(apiId, apiHash.trim(), {
      phone: () => rl.question("Телефон (+7…): "),
      code: () => rl.question("Код из Telegram: "),
      password: () => rl.question("Пароль 2FA (Enter, если не включён): "),
    });

    // Smoke: проверяем, что полученная строка реально логинит аккаунт.
    const client = createMtprotoClient(apiId, apiHash.trim(), session);
    try {
      const label = await fetchSelfLabel(client);
      console.log(`\n✅ Вошли как ${label}`);
    } finally {
      await client.disconnect();
    }

    const line = "=".repeat(60);
    console.log(`\n${line}`);
    console.log("TELEGRAM_SESSION (скопируй в переменные Railway / локальный .env):\n");
    console.log(session);
    console.log(`${line}`);
    console.log(
      "\n⚠️ Это полный доступ к аккаунту. НЕ коммить в git, НЕ вставляй в код.",
    );
  } finally {
    rl.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
