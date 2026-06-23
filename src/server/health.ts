import { createServer, type Server } from "node:http";
import { type Logger } from "pino";

/**
 * Крошечный HTTP-сервер, отвечающий 200 на любой запрос.
 * Нужен для health-check хостинга (Koyeb): web-сервис должен слушать порт,
 * иначе деплой считается «нездоровым». Локально безвреден.
 */
export function startHealthServer(port: number, logger: Logger): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });

  server.listen(port, () => {
    logger.info({ port }, "health server listening");
  });

  return server;
}
