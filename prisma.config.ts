import { defineConfig } from "prisma/config";

// Подхватываем .env нативно (как в src/index.ts) — без зависимости dotenv.
// На хостинге файла нет, переменные приходят из окружения — ошибку игнорируем.
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — это нормально в проде.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Строка подключения для CLI/Migrate (Prisma 7).
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
