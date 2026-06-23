import pino, { type Logger } from "pino";

/** Создаёт структурный логгер pino с заданным уровнем. */
export function createLogger(level: string): Logger {
  return pino({ level });
}
