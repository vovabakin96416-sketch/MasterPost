# MasterPost — AI Channel Manager (бот)

Универсальный бот-управитель Telegram-каналов на TypeScript. Подстраивается под любую
тематику; первый канал для обкатки — таро @sofia_gada1ka. Источник правды по проекту —
`ПЛАН.md`, статус — `ПРОГРЕСС.md`.

## Шаг 0 — каркас

Строгий TypeScript-скелет (grammY + zod + pino), отвечает на `/start`.

### Запуск локально

```bash
npm install
cp .env.example .env   # и вписать BOT_TOKEN из @BotFather
npm run dev
```

В Telegram напиши боту `/start` — должен ответить.

### Проверки

```bash
npm run typecheck   # типы
npm run lint        # ESLint (без any)
npm run test        # vitest
```

### Сборка / прод

```bash
npm run build       # tsc → dist/
npm start           # node dist/index.js
```

## Безопасность

Секреты (`BOT_TOKEN` и будущие API-ключи) живут только в `.env` (в `.gitignore`) и в
переменных окружения хостинга. В репозиторий секреты НЕ коммитятся — он публичный.
