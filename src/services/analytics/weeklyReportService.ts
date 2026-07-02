import { getPostingChannel } from "../../db/repositories/channelRepository.js";
import { upsertPostMetric } from "../../db/repositories/postMetricRepository.js";
import { buildWeeklyReport } from "../../core/analytics/weeklyReport.js";
import {
  isMtprotoConfigured,
  type FullMtprotoConfig,
  type MtprotoConfig,
} from "./mtprotoConfig.js";
import { type AnalyticsDeps, sendToAdmin } from "../analyticsService.js";

/**
 * Сервис еженедельного отчёта по просмотрам (Шаг 7c) — порт `weekly_stats_report`.
 *
 * ⚠️ ИЗОЛЯЦИЯ (принцип 7b): тяжёлый GramJS не должен попадать в СТАТИЧЕСКИЙ импорт-граф
 * запущенного бота. Поэтому `mtprotoClient.ts` подгружается ТОЛЬКО динамическим
 * `await import()` — внутри отчёта и лишь когда MTProto реально настроен. При старте бота
 * GramJS не грузится (меню берёт только статус из чистого `mtprotoConfig.ts`).
 */

/** Зависимости отчёта: всё, что у аналитики, плюс конфиг MTProto (env `TELEGRAM_*`). */
export interface WeeklyReportDeps extends AnalyticsDeps {
  mtproto: MtprotoConfig;
}

/** Окно отчёта — последние 7 дней (как `timedelta(days=7)` в Python). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const MTPROTO_NOT_CONFIGURED = [
  "⚠️ Отчёт по просмотрам выключен — MTProto не настроен.",
  "",
  "Получи api_id/api_hash на my.telegram.org, затем выполни `npm run gen-session`",
  "и впиши TELEGRAM_API_ID/HASH/SESSION в переменные хостинга.",
].join("\n");

const NO_CHANNEL_TARGET =
  "⚠️ Не задан канал для аналитики. Укажи его в «📅 Автопостинг → 📡 Указать канал».";

const SESSION_REVOKED = [
  "❌ Сессия MTProto отозвана Telegram — отчёт по просмотрам собрать нельзя.",
  "",
  "Что сделать:",
  "1. Локально выполни `npm run gen-session` (или `npm run gen-session-qr`).",
  "2. Впиши новую строку в TELEGRAM_SESSION в переменных Railway.",
  "3. Перезапусти сервис.",
  "",
  "⚠️ Не используй одну сессию с двух IP одновременно (локально + Railway) —",
  "Telegram отзывает ключ.",
].join("\n");

/** Мёртвая строка-сессия: AUTH_KEY_UNREGISTERED / _DUPLICATED / _INVALID от Telegram. */
function isSessionRevokedError(err: unknown): boolean {
  return /AUTH_KEY/i.test(String(err));
}

/**
 * Подключается под личным аккаунтом, читает метрики постов канала за неделю, сохраняет
 * снимки в БД и собирает текст отчёта. Динамический импорт GramJS — здесь. Соединение
 * всегда закрываем (try/finally).
 */
async function collectReport(
  deps: WeeklyReportDeps,
  channelId: string,
  chatId: string,
  timezone: string,
  cfg: FullMtprotoConfig,
): Promise<string> {
  const { createMtprotoClient, fetchRecentPostMetrics } = await import(
    "./mtprotoClient.js"
  );
  const client = createMtprotoClient(cfg.apiId, cfg.apiHash, cfg.session);
  try {
    await client.connect();
    const since = new Date(Date.now() - WEEK_MS);
    const metrics = await fetchRecentPostMetrics(client, chatId, since);
    for (const metric of metrics) {
      await upsertPostMetric(deps.prisma, channelId, metric);
    }
    return buildWeeklyReport(metrics, timezone);
  } finally {
    // Именно destroy(): disconnect() оставляет жить update-loop GramJS, и при
    // мёртвой сессии он бесконечно спамит тайм-аутами в логи.
    await client.destroy();
  }
}

/**
 * Тик планировщика (ПН 09:30 МСК): собрать и прислать владельцу отчёт за неделю. Если
 * MTProto не настроен или нет канала — тихо (бот работает как раньше). Ошибки логируем.
 */
export async function runWeeklyReport(deps: WeeklyReportDeps): Promise<void> {
  const cfg = deps.mtproto;
  if (!isMtprotoConfigured(cfg)) {
    return;
  }
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null || channel.chatId === null) {
    return;
  }
  try {
    const report = await collectReport(
      deps,
      channel.id,
      channel.chatId,
      channel.timezone,
      cfg,
    );
    await sendToAdmin(deps, report);
    deps.logger.info("отправлен еженедельный отчёт по просмотрам");
  } catch (err) {
    deps.logger.error({ err }, "ошибка еженедельного отчёта по просмотрам");
    // Мёртвая сессия сама не оживёт — молчать нельзя, иначе отчёты пропадут навсегда.
    if (isSessionRevokedError(err)) {
      await sendToAdmin(deps, SESSION_REVOKED);
    }
  }
}

/**
 * Принудительная отправка отчёта (тест-кнопка в меню). В отличие от джоба не молчит:
 * при «не настроено / нет канала / ошибка» шлёт владельцу понятное пояснение.
 */
export async function sendWeeklyReportNow(deps: WeeklyReportDeps): Promise<void> {
  const cfg = deps.mtproto;
  if (!isMtprotoConfigured(cfg)) {
    await sendToAdmin(deps, MTPROTO_NOT_CONFIGURED);
    return;
  }
  const channel = await getPostingChannel(deps.prisma);
  if (channel === null || channel.chatId === null) {
    await sendToAdmin(deps, NO_CHANNEL_TARGET);
    return;
  }
  try {
    const report = await collectReport(
      deps,
      channel.id,
      channel.chatId,
      channel.timezone,
      cfg,
    );
    await sendToAdmin(deps, report);
  } catch (err) {
    deps.logger.error({ err }, "ошибка ручного отчёта по просмотрам");
    await sendToAdmin(
      deps,
      isSessionRevokedError(err)
        ? SESSION_REVOKED
        : `❌ Не удалось собрать отчёт по просмотрам.\nПричина: ${String(err)}`,
    );
  }
}
