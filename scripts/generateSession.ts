/**
 * generateSession.ts — запусти ОДИН РАЗ локально для получения TELEGRAM_SESSION.
 *
 * Два способа входа под ЛИЧНЫМ аккаунтом (НЕ ботом — токен бота не читает просмотры):
 *   • `npm run gen-session`      — по телефону: телефон → код из Telegram → 2FA.
 *   • `npm run gen-session-qr`   — по QR-коду (флаг --qr): сканируешь QR в приложении
 *                                  Telegram, код руками вводить не надо. Запасной способ,
 *                                  если код подтверждения не доходит.
 * В конце печатает строку TELEGRAM_SESSION для вставки в переменные Railway / локальный .env.
 *
 * Тонкая обёртка: вся GramJS-логика — в типобезопасном `src/services/analytics/
 * mtprotoClient.ts`, здесь только readline-ввод и рисование QR. На сервере файл НЕ нужен.
 *
 * ⚠️ SESSION = полный доступ к аккаунту. НИКОГДА не коммить строку в git и не вставляй её в
 *    код — только в env Railway / локальный .env (он в .gitignore).
 * ⚠️ QR рисуем ЛОКАЛЬНО (lib `qrcode`), НИКОГДА не через веб-генераторы — `tg://login?token=…`
 *    это живой токен входа в аккаунт.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as qrcode from "qrcode";
import {
  createMtprotoClient,
  fetchSelfLabel,
  loginInteractive,
  loginInteractiveQr,
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

/** Куда кладём QR-картинку (системный temp, не репо) — и открыта ли она уже. */
const QR_PNG_PATH = path.join(os.tmpdir(), "mtproto-login-qr.png");
let qrPngOpened = false;

/** Рисуем QR из deeplink: ASCII прямо в окно + PNG в temp с авто-открытием (один раз). */
async function showQr(url: string): Promise<void> {
  const ascii = await qrcode.toString(url, { type: "terminal", small: true });
  console.log(`\n${ascii}`);
  try {
    await qrcode.toFile(QR_PNG_PATH, url, { width: 400 });
    if (!qrPngOpened) {
      qrPngOpened = true;
      console.log(`Если QR в окне читается плохо — открыта картинка: ${QR_PNG_PATH}`);
      spawn("cmd", ["/c", "start", "", QR_PNG_PATH], {
        stdio: "ignore",
        detached: true,
      }).unref();
    }
  } catch {
    // PNG/авто-открытие не критичны — ASCII в окне уже показан.
  }
}

/** Общий хвост обоих способов: smoke-проверка строки + печать TELEGRAM_SESSION. */
async function reportSession(
  apiId: number,
  apiHash: string,
  session: string,
): Promise<void> {
  // Smoke: проверяем, что полученная строка реально логинит аккаунт.
  const client = createMtprotoClient(apiId, apiHash, session);
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
}

async function main(): Promise<void> {
  const useQr = process.argv.includes("--qr");
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Где взять api_id / api_hash: https://my.telegram.org → API development tools\n");

    const apiIdRaw =
      envOrUndefined("TELEGRAM_API_ID") ??
      (await rl.question("api_id (число): "));
    const apiHash = (
      envOrUndefined("TELEGRAM_API_HASH") ?? (await rl.question("api_hash: "))
    ).trim();

    const apiId = Number(apiIdRaw.trim());
    if (!Number.isInteger(apiId) || apiId <= 0) {
      console.error("❌ api_id должен быть положительным целым числом.");
      process.exitCode = 1;
      return;
    }

    let session: string;
    if (useQr) {
      console.log(
        "\nСпособ входа: QR-код.\n" +
          "На телефоне: Telegram → Настройки → Устройства → Подключить устройство\n" +
          "(Link Desktop Device) → наведи камеру на QR ниже.\n" +
          "QR обновляется каждые ~30 секунд — сканируй самый свежий (нижний).\n",
      );
      session = await loginInteractiveQr(apiId, apiHash, {
        onQrUrl: showQr,
        password: () => rl.question("Пароль 2FA (Enter, если не включён): "),
      });
    } else {
      session = await loginInteractive(apiId, apiHash, {
        phone: () => rl.question("Телефон (+7…): "),
        code: () => rl.question("Код из Telegram: "),
        password: () => rl.question("Пароль 2FA (Enter, если не включён): "),
      });
    }

    await reportSession(apiId, apiHash, session);
  } finally {
    rl.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
