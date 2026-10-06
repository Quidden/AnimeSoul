[English](README.md) | [Русский](README.ru.md)

# AnimeSoul — новый веб-проект

Основа сайта: TypeScript, Next.js/React, NestJS/Fastify и PostgreSQL/Prisma.
Android ведётся в самостоятельном репозитории. Разработка десктопного приложения прекращена.

## Локальный запуск

Нужны Node.js 24 и pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Сайт: http://localhost:8021 · API: http://127.0.0.1:8020 · админка: http://localhost:8022.
Первый предпросмотр использует явно обозначенные тестовые данные. Реальный аккаунт ещё не перенесён.
Индексация локального сайта отключена. Ctrl+C останавливает только сервисы этого запуска.

Для PostgreSQL и Redis запустите Docker Desktop:

```sh
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm db:seed
```

DEMO_CATALOG=false в приватном .env переключает API на PostgreSQL.
Тестовое наполнение запрещено в production и не создаёт администратора.
Проверка готовности API возвращает 503, пока настоящая база не отвечает.

## Проверки

```sh
pnpm check
pnpm format:check
pnpm audit --audit-level high
```

HTTP-тесты сайта поднимают изолированные собранные сервисы на портах 18020–18022.
Документация находится в [docs](docs/README.ru.md), приложения — в apps, общие пакеты — в packages,
инфраструктура — в infra. Сборки, базы, приватные настройки и загрузки пользователей не попадают в Git.

[Выполненные работы и следующие условия](docs/migration/STATUS.ru.md) ·
[Архитектура основы](docs/architecture/FOUNDATION.ru.md) ·
[Полный план](docs/architecture/WEB_STACK_PLAN.ru.md).

Предыдущая реализация сохранена в ветке codex/archive-current-2026-10-06
и теге archive-current-2026-10-06.
