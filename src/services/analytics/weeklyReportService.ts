import {
  getPostingChannel,
  getPostingChannelById,
} from "../../db/repositories/channelRepository.js";
import { upsertPostMetric } from "../../db/repositories/postMetricRepository.js";
import { buildWeeklyReport } from "../../core/analytics/weeklyReport.js";
import { buildGrowthReport } from "./contentIntelligenceService.js";
import { buildExperimentProgress } from "../experiments/experimentService.js";
import { maybeAutoApplyExperimentWinner } from "../experiments/optimizationService.js";
import { narrateGrowthReport } from "../ai/growthNarrativeService.js";
import { createTelemetrProvider } from "../market/telemetrProvider.js";
import { buildMarketSectionText } from "../market/marketStatService.js";
import {
  isMtprotoConfigured,
  type FullMtprotoConfig,
  type MtprotoConfig,
} from "./mtprotoConfig.js";
import {
  type AnalyticsDeps,
  ownerTargetOf,
  sendToAdmin,
  sendToUser,
} from "../analyticsService.js";

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
  // Шаг 12d: ключ Anthropic для AI-пересказа секции роста. undefined → секция
  // остаётся эвристическим текстом 12c (как pexelsApiKey у фото — мягко).
  anthropicApiKey?: string | undefined;
  // Шаг 11b: таймаут вызова Claude (мс); undefined → DEFAULT_AI_TIMEOUT_MS.
  timeoutMs?: number | undefined;
  // Шаг 12e-2: ключ Telemetr для секции «🌍 Рынок» в отчёте. undefined →
  // секции просто нет (мягко, как telemetrApiKey на экране «📈 Рост»).
  telemetrApiKey?: string | undefined;
}

/** Окно отчёта — последние 7 дней (как `timedelta(days=7)` в Python). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Канал в объёме отчёта: адресат MTProto + ссылка для рыночного среза (12e-2). */
interface ReportChannel {
  readonly id: string;
  readonly chatId: string;
  readonly timezone: string;
  readonly username: string | null;
}

const MTPROTO_NOT_CONFIGURED = [
  "⚠️ Отчёт по просмотрам выключен — MTProto не настроен.",
  "",
  "Получи api_id/api_hash на my.telegram.org, затем выполни `npm run gen-session`",
  "и впиши TELEGRAM_API_ID/HASH/SESSION в переменные хостинга.",
].join("\n");

const NO_CHANNEL_TARGET =
  "⚠️ Не задан канал для аналитики. Укажи его в «📅 Автопостинг → 🎯 Канал публикации».";

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
  channel: ReportChannel,
  cfg: FullMtprotoConfig,
): Promise<string> {
  const { createMtprotoClient, fetchRecentPostMetrics } = await import(
    "./mtprotoClient.js"
  );
  const client = createMtprotoClient(cfg.apiId, cfg.apiHash, cfg.session);
  try {
    await client.connect();
    const since = new Date(Date.now() - WEEK_MS);
    const metrics = await fetchRecentPostMetrics(client, channel.chatId, since);
    for (const metric of metrics) {
      await upsertPostMetric(deps.prisma, channel.id, metric);
    }
    const weekly = buildWeeklyReport(metrics, channel.timezone, {
      username: channel.username,
      chatId: channel.chatId,
    });
    // Шаг 12c: после сырых чисел — секция Content Intelligence (выводы/рекомендации).
    // Метрики только что записаны в БД, так что отчёт читает свежие данные. 0 токенов.
    const growth = await buildGrowthReport(deps.prisma, channel.id, channel.timezone);
    // Шаг 12d: при ВКЛ тумблере «🧠 AI-пересказ» те же факты пересказывает Haiku
    // голосом канала; выключен/нет ключа/бюджет/ошибка → сухой текст без изменений.
    const narrated = await narrateGrowthReport(
      {
        prisma: deps.prisma,
        logger: deps.logger,
        apiKey: deps.anthropicApiKey,
        timeoutMs: deps.timeoutMs,
      },
      channel.id,
      growth,
    );
    // Шаг 12e-2: секция «🌍 Рынок» — та же, что на экране «📈 Рост» (реюз, кэш
    // Setting TTL 12ч бережёт лимит). Без ключа/данных секции нет, отчёт как раньше.
    const market = await buildMarketSectionText(
      deps.prisma,
      deps.logger,
      channel,
      createTelemetrProvider({
        apiKey: deps.telemetrApiKey,
        logger: deps.logger,
      }),
    );
    const marketBlock = market === null ? "" : `\n\n${market}`;
    // Шаг 13d: секция активного эксперимента (прогресс вариантов + вердикт 13a).
    // Нет активного эксперимента → блока нет (мягко, как «Рынок»). 0 токенов, из БД.
    const experiments = await buildExperimentProgress(
      deps.prisma,
      channel.id,
      channel.timezone,
    );
    const experimentBlock = experiments === null ? "" : `\n\n${experiments}`;
    return `${weekly}\n\n───────────────\n\n${narrated}${experimentBlock}${marketBlock}`;
  } finally {
    // Именно destroy(): disconnect() оставляет жить update-loop GramJS, и при
    // мёртвой сессии он бесконечно спамит тайм-аутами в логи.
    await client.destroy();
  }
}

/**
 * Тик планировщика (ПН 09:30 МСК): собрать и прислать владельцу КАНАЛА отчёт за
 * неделю (14b-2; канал без владельца → супервладелец). Если MTProto не настроен или
 * нет канала — тихо (бот работает как раньше). Ошибки логируем.
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
  const target = await ownerTargetOf(deps, channel.id);
  try {
    const report = await collectReport(
      deps,
      { ...channel, chatId: channel.chatId },
      cfg,
    );
    await sendToUser(deps, target, report);
    deps.logger.info("отправлен еженедельный отчёт по просмотрам");
    // Шаг 13e: ПН-обзор — момент подвести итог эксперимента. При ВКЛ авто-применении
    // и вердикте `winner` записываем победителя в стратегию канала (метрики только что
    // обновлены в collectReport). ВЫКЛ (дефолт) → тихо. Сбой не должен ронять отчёт.
    try {
      const applied = await maybeAutoApplyExperimentWinner(
        deps.prisma,
        deps.logger,
        channel.id,
        new Date(),
      );
      if (applied.status === "applied") {
        await sendToUser(
          deps,
          target,
          `🔁 Авто-применение: победитель эксперимента «${applied.dimensionLabel}» — ` +
            `вариант «${applied.variantLabel}» записан в стратегию канала.`,
        );
      }
    } catch (autoErr) {
      deps.logger.warn({ err: autoErr }, "сбой авто-применения победителя эксперимента");
    }
  } catch (err) {
    deps.logger.error({ err }, "ошибка еженедельного отчёта по просмотрам");
    // Мёртвая сессия сама не оживёт — молчать нельзя, иначе отчёты пропадут навсегда.
    // Чинит её супервладелец (env Railway), поэтому сигнал — ему, не владельцу канала.
    if (isSessionRevokedError(err)) {
      await sendToAdmin(deps, SESSION_REVOKED);
    }
  }
}

/**
 * Принудительная отправка отчёта (тест-кнопка в меню). В отличие от джоба не молчит:
 * при «не настроено / нет канала / ошибка» шлёт понятное пояснение. Шаг 14b-2:
 * `channelId` — ВЫБРАННЫЙ канал нажавшего (раньше сервис брал первый канал в БД —
 * чужой владелец получил бы не свой отчёт), а `deps.adminId` вызывающий задаёт
 * нажавшим, так что все сообщения уходят ему.
 */
export async function sendWeeklyReportNow(
  deps: WeeklyReportDeps,
  channelId?: string,
): Promise<void> {
  const cfg = deps.mtproto;
  if (!isMtprotoConfigured(cfg)) {
    await sendToAdmin(deps, MTPROTO_NOT_CONFIGURED);
    return;
  }
  const channel =
    channelId === undefined
      ? await getPostingChannel(deps.prisma)
      : await getPostingChannelById(deps.prisma, channelId);
  if (channel === null || channel.chatId === null) {
    await sendToAdmin(deps, NO_CHANNEL_TARGET);
    return;
  }
  try {
    const report = await collectReport(
      deps,
      { ...channel, chatId: channel.chatId },
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
