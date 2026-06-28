import { describe, expect, it, vi } from "vitest";
import { GrammyError, type Api } from "grammy";
import type { Logger } from "pino";
import {
  sendApprovalPreview,
  sendPost,
  type PostingDeps,
} from "../src/services/postingService";

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

/** Собирает PostingDeps с подменённым Telegram API. */
function makeDeps(api: Partial<Api>): PostingDeps {
  return {
    prisma: {} as never,
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
      .mockResolvedValueOnce(undefined);
    const sendMessage = vi.fn();
    await sendPost(makeDeps({ sendPhoto, sendMessage }), 1, "text", URL_PHOTO);
    expect(sendPhoto).toHaveBeenCalledTimes(2);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ошибка фото не про разметку → сразу текстом (фото 1 раз)", async () => {
    const sendPhoto = vi.fn().mockRejectedValue(new Error("network"));
    const sendMessage = vi.fn().mockResolvedValue(undefined);
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
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    await expect(
      sendPost(makeDeps({ sendPhoto, sendMessage }), 1, "text", URL_PHOTO),
    ).resolves.toBeUndefined();
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
    await sendApprovalPreview(makeDeps({ sendMessage }), "*caption*", "pending1", null);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const fallback = sendMessage.mock.calls[1];
    expect(fallback[0]).toBe(42); // adminId
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
    await sendApprovalPreview(makeDeps({ sendMessage }), "*caption*", "pending1", null);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    const notify = sendMessage.mock.calls[2];
    expect(notify[0]).toBe(42);
    expect(String(notify[1])).toContain("Прислать на тест");
  });
});
