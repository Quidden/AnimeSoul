[English](README.md) | [Русский](README.ru.md)

# AnimeSoul — новый веб-проект

Основа сайта: TypeScript, Next.js/React, NestJS/Fastify и PostgreSQL/Prisma.
Android ведётся в самостоятельном репозитории. Разработка десктопного приложения прекращена.

Основная рабочая папка — `C:/Users/dogem/Documents/AnimeSoul`, ветка `main`.
Старая локальная версия вместе с настройками, базами и релизами сохранена в соседней
`C:/Users/dogem/Documents/AnimeSoulArchive`, ветка `codex/legacy-local-2026-10-06`.
Перенос функций продолжается: авторизация, сохранения, плеер и полноценная админка ещё не перенесены.

## Навигация по проекту

| Что нужно найти                           | Документ                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| Папки, точки входа и связи приложений     | [Карта проекта](docs/architecture/PROJECT_MAP.ru.md)            |
| Страницы, переходы, разделы профиля и API | [Карта сайта](docs/architecture/SITE_MAP.ru.md)                 |
| Таблицы, UUID, DTO и приватность          | [Модель данных](docs/architecture/DATA_MODEL.ru.md)             |
| Запуск, настройки, БД и проверки          | [Локальная разработка](docs/operations/LOCAL_DEVELOPMENT.ru.md) |
| Все документы и порядок чтения            | [Индекс документации](docs/README.ru.md)                        |

`apps` содержит сайт, API и админку; `packages` — общие контракты, БД и конфигурации;
`scripts` — утилиты по назначению; `infra` — локальную инфраструктуру; `tests` — проверки сценариев.
Рабочая карта описывает текущую реализацию, план — будущие этапы.

## Локальный запуск

Нужны Node.js 24 и pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

В Windows можно запустить [Start AnimeSoul.bat](scripts/windows/Start%20AnimeSoul.bat).
Он запускает этот TypeScript-проект и сохраняет существующий `.env`.
Если pnpm не установлен, используется `npx` с закреплённой версией pnpm 11.25.0;
для первого скачивания потребуется интернет.

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
Seed добавляет только demo-аниме, без профиля/аккаунта; подключение БД не переносит старые данные.
Docker на этой машине пока недоступен; demo-предпросмотр работает без него.

## Проверки

```sh
pnpm check
pnpm format:check
pnpm audit --audit-level high
```

HTTP-тесты сайта поднимают изолированные собранные сервисы на портах 18020–18022.
Документация находится в [docs](docs/README.ru.md), приложения — в apps, общие пакеты — в packages,
инфраструктура — в infra. Сборки, базы, приватные настройки и загрузки пользователей не попадают в Git.
ESLint/Prettier и TypeScript настраиваются в `packages/config`; команды описаны в
[инструкции](docs/operations/LOCAL_DEVELOPMENT.ru.md). Корневые Git/editor/ignore-файлы оставлены
на стандартных местах для автоматического обнаружения инструментами.

[Выполненные работы и следующие условия](docs/migration/STATUS.ru.md) ·
[Архитектура основы](docs/architecture/FOUNDATION.ru.md) ·
[Полный план](docs/architecture/WEB_STACK_PLAN.ru.md).

Предыдущая реализация сохранена в ветке codex/archive-current-2026-10-06
и теге archive-current-2026-10-06.
