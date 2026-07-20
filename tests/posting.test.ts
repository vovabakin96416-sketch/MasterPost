import { afterEach, describe, expect, it, vi } from "vitest";
import { GrammyError, type Api } from "grammy";
import type { Logger } from "pino";
import {
  publishDuePostsForChannel,
  requestApprovalForDraft,
  sendApprovalPreview,
  sendPost,
  type PostingDeps,
} from "../src/services/postingService";
import type { PostingChannel } from "../src/db/repositories/channelRepository";

/** Тихий логгер-заглушка (без реального pino). */
const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

/** Конструирует GrammyError с нужным описанием (для веток разметки/фото). */
function grammyError(method: string, description: string): GrammyError {
  return new GrammyError(
    `Call to '${method}' failed!`,
    { ok: false, error_code: 400, description },
    method,
    {},
  );
}

const PARSE = "Bad Request: can't parse entities";
const BAD_PHOTO = "Bad Request: failed to get HTTP URL content";
const TOO_LONG = "Bad Request: message is too long";

/**
 * Prisma-заглушка для резолва владельца канала (Шаг 14b-2): канал без владельца →
 * адресат уведомлений/превью падает на супервладельца (adminId 42).
 */
function ownerlessPrisma(extra: Record<string, unknown> = {}): PostingDeps["prisma"] {
  return {
    channel: { findUnique: vi.fn().mockResolvedValue({ owner: null }) },
    ...extra,
  } as unknown as PostingDeps["prisma"];
}

/** Собирает PostingDeps с подменённым Telegram API. */
function makeDeps(api: Partial<Api>): PostingDeps {
  return {
    prisma: ownerlessPrisma(),
    logger: silentLogger,
    api: api as unknown as Api,
    adminId: 42,
    pexelsApiKey: undefined,
  };
}

const URL_PHOTO = { kind: "url", url: "http://x/img.jpg" } as const;

describe("sendPost: фото не должно «съедать» пост", () => {
  it("кривой Markdown в подписи → повтор фото без разметки", async () => {
    const sendPhoto = vi
      .fn()
      .mockRejectedValueOnce(grammyError("sendPhoto", PARSE))
      .mockResolvedValueOnce({ message_id: 100 });
    const sendMessage = vi.fn();
    await sendPost(makeDeps({ sendPhoto, sendMessage }), 1, "text", URL_PHOTO);
    expect(sendPhoto).toHaveBeenCalledTimes(2);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ошибка фото не про разметку → сразу текстом (фото 1 раз)", async () => {
    const sendPhoto = vi.fn().mockRejectedValue(new Error("network"));
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 100 });
    await sendPost(makeDeps({ sendPhoto, sendMessage }), 1, "text", URL_PHOTO);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("регресс: повтор фото падает по битому URL → пост всё равно уходит текстом", async () => {
    // Раньше повтор sendPhoto был вне try/catch — его ошибка вылетала мимо
    // текстового фолбэка и «съедала» пост/превью.
    const sendPhoto = vi
      .fn()
      .mockRejectedValueOnce(grammyError("sendPhoto", PARSE))
      .mockRejectedValueOnce(grammyError("sendPhoto", BAD_PHOTO));
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 100 });
    await expect(
      sendPost(makeDeps({ sendPhoto, sendMessage }), 1, "text", URL_PHOTO),
    ).resolves.toBe(100);
    expect(sendPhoto).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("sendApprovalPreview: превью одобрения всегда доходит", () => {
  it("при полном провале отправки шлёт простой текст с кнопками одобрения", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(grammyError("sendMessage", TOO_LONG)) // внутри sendPost
      .mockResolvedValueOnce(undefined); // запасной простой текст
    await sendApprovalPreview(
      makeDeps({ sendMessage }),
      "ch1",
      "*caption*",
      "pending1",
      null,
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const fallback = sendMessage.mock.calls[1];
    expect(fallback[0]).toBe(42); // канал без владельца → супервладелец
    expect(fallback[1]).toBe("*caption*");
    expect(fallback[2]).toHaveProperty("reply_markup"); // клавиатура одобрения
    expect(fallback[2]).not.toHaveProperty("parse_mode"); // без Markdown
  });

  it("если и запасной текст упал → уведомляет админа (notifyAdmin)", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(grammyError("sendMessage", TOO_LONG)) // внутри sendPost
      .mockRejectedValueOnce(grammyError("sendMessage", BAD_PHOTO)) // запасной текст
      .mockResolvedValueOnce(undefined); // notifyAdmin
    await sendApprovalPreview(
      makeDeps({ sendMessage }),
      "ch1",
      "*caption*",
      "pending1",
      null,
    );
    expect(sendMessage).toHaveBeenCalledTimes(3);
    const notify = sendMessage.mock.calls[2];
    expect(notify[0]).toBe(42);
    // Подсказка ведёт в список очереди — до Шага 14 она звала к кнопке, которой не было.
    expect(String(notify[1])).toContain("Прислать превью с кнопками");
  });
});

describe("requestApprovalForDraft: обобщённая постановка в очередь (Шаг 10b)", () => {
  it("AI-черновик (externalId=null) → снимок с pexelsQuery + превью админу", async () => {
    // Без ключа Pexels фото не подберётся (photoUrl=null), сетевого вызова нет.
    const create = vi.fn().mockResolvedValue({ id: "p1" });
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 100 });
    const prisma = ownerlessPrisma({
      setting: { findUnique: vi.fn().mockResolvedValue(null) }, // media_tier не задан → free
      pendingPost: { create },
    });
    const deps: PostingDeps = { ...makeDeps({ sendMessage }), prisma };

    await requestApprovalForDraft(deps, "ch1", "@chan", {
      title: "Заголовок",
      text: "Тело",
      cta: "Подпишись",
      externalId: null,
      pexelsQuery: "moon",
      photoSources: { photoUrl: null, pexelsQuery: "moon", photoPath: null },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      channelId: "ch1",
      externalId: null,
      pexelsQuery: "moon", // кэшируем запрос → «🔄 Другое фото» сработает у AI-поста
      photoUrl: null, // нет ключа Pexels → фото не подобралось
      title: "Заголовок",
    });
    // Превью ушло админу (фото null → простым сообщением).
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(42); // adminId
  });
});

describe("publishDuePostsForChannel: прогресс пишется после каждого времени", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Строка поста в форме `select` из getPostsForDay (без фото и кнопок). */
  function postRow(externalId: number): Record<string, unknown> {
    return {
      externalId,
      title: `t${String(externalId)}`,
      text: "x",
      cta: "c",
      pexelsQuery: null,
      photoPath: null,
      photoFileId: null,
      interactiveType: "keyword_trigger",
      choices: null,
      button: null,
    };
  }

  it("ошибка первой публикации не теряет прогресс: upsert после каждого времени", async () => {
    // Фиксируем «сейчас» (полдень МСК), чтобы оба времени 00:00/00:01 были due.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:00:00Z"));

    const settings: Record<string, unknown> = {
      autopost_enabled: true,
      autopost_times: ["00:00", "00:01"],
      approval_enabled: false,
    };
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = ownerlessPrisma({
      setting: {
        findUnique: vi.fn(
          ({ where }: { where: { channelId_key: { key: string } } }) => {
            const value = settings[where.channelId_key.key];
            return Promise.resolve(value === undefined ? null : { value });
          },
        ),
        upsert,
      },
      post: { findMany: vi.fn().mockResolvedValue([postRow(1), postRow(2)]) },
    });

    // Первый пост падает не-Telegram ошибкой, второй уходит нормально.
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ message_id: 100 });
    const deps: PostingDeps = { ...makeDeps({ sendMessage }), prisma };
    const channel: PostingChannel = {
      id: "ch1",
      chatId: "@target",
      timezone: "Europe/Moscow",
      // Старт уже зафиксирован — тест про прогресс, а не про якорение недели
      // (иначе publishDuePostsForChannel полез бы за campaignStart в БД).
      campaignStart: new Date("2026-07-01T00:00:00Z"),
      title: "Тест",
      username: null,
    };

    await publishDuePostsForChannel(deps, channel);

    // Раньше прогресс писался одним куском после цикла — рестарт посреди цикла
    // публиковал уже отправленные посты повторно. Теперь запись после каждого времени.
    expect(upsert).toHaveBeenCalledTimes(2);
    const first = upsert.mock.calls[0][0] as {
      create: { value: { postedTimes: string[] } };
    };
    const second = upsert.mock.calls[1][0] as {
      create: { value: { postedTimes: string[] } };
    };
    expect(first.create.value.postedTimes).toEqual(["00:00"]);
    expect(second.create.value.postedTimes).toEqual(["00:00", "00:01"]);
  });
});
