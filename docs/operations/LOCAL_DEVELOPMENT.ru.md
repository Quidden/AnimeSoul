[English](LOCAL_DEVELOPMENT.md) | [Русский](LOCAL_DEVELOPMENT.ru.md)

# Локальная разработка

Команды выполняются из корня нового `main`. Нужны Node.js 24 и pnpm 11.25.0,
закреплённые в [package.json](../../package.json). Для demo-предпросмотра Docker не нужен.

## Первый запуск

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Windows: [scripts/windows/Start AnimeSoul.bat](../../scripts/windows/Start%20AnimeSoul.bat).
Launcher сам переходит в корень, проверяет Node.js 24, устанавливает зависимости, если их ещё нет,
сохраняет имеющийся `.env` и запускает `pnpm dev`. Без установленного pnpm используется
`npx --yes pnpm@11.25.0`; первое скачивание требует интернета.

`setup` создаёт `.env` из [.env.example](../../.env.example) один раз со случайным локальным паролем.
Рабочие ключи и старые настройки из архива автоматически не импортируются.

| Сервис     | Адрес                   | Назначение                                                  |
| ---------- | ----------------------- | ----------------------------------------------------------- |
| Web        | `http://localhost:8021` | Публичный Next.js сайт                                      |
| API        | `http://127.0.0.1:8020` | Каталог/профили, `/api/health`, `/api/ready`                |
| Admin      | `http://localhost:8022` | Страница закрытого административного доступа                |
| PostgreSQL | `127.0.0.1:54329`       | База `animesoul`, если запущен compose                      |
| Redis      | `127.0.0.1:6391`        | Локальная инфраструктура; интеграции с приложением пока нет |

`pnpm dev` сначала генерирует Prisma Client и собирает contracts/database/API,
затем запускает API и два Next.js dev-сервера. Web/admin обновляются при редактировании;
после изменения API или общих скомпилированных пакетов запуск нужно перезапустить.
Ctrl+C останавливает только процессы этого запуска. При занятом порте сначала остановите
предыдущий свой запуск; не завершайте все процессы Node.js на машине.

## Настройки и их потребители

| Переменная             | Кто читает сейчас                    | Значение/смысл                                                                  |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `SITE_URL`             | `apps/web/lib/site.ts`               | Канонический origin, локально `http://localhost:8021`                           |
| `API_URL`              | `apps/web/lib/api.ts`, только сервер | Адрес API, локально `http://127.0.0.1:8020`                                     |
| `API_HOST`, `API_PORT` | `apps/api/src/config.ts`             | API bind, по умолчанию `127.0.0.1:8020`                                         |
| `NODE_ENV`             | API и Next.js                        | В production API запрещает demo и требует БД                                    |
| `DEMO_CATALOG`         | API, Web и seed                      | `true` — fixtures в памяти; `false` — чтение PostgreSQL                         |
| `DATABASE_URL`         | API, Prisma CLI, seed                | Приватная строка подключения PostgreSQL                                         |
| `POSTGRES_PASSWORD`    | `infra/compose.dev.yaml`             | Пароль локального контейнера; setup согласует его с шаблоном `DATABASE_URL`     |
| `PUBLIC_INDEXING`      | Web                                  | По умолчанию false; true требует публичного HTTPS и выключенного demo           |
| `REDIS_URL`            | Пока ни один runtime-модуль          | Зарезервировано; Redis compose работает без интеграции приложения               |
| `ALLOW_YUMMY`          | Пока не подключён к runtime          | Зарезервированный default-disabled запрет; наличие true не запускает провайдера |
| `PAYMENTS_ENABLED`     | Пока не подключён к runtime          | Зарезервировано; изменение флага не создаёт оплату                              |
| `TEST_DATABASE_URL`    | `tests/database.test.mjs`            | Только отдельная локальная БД с именем, заканчивающимся на `_test`              |

Корневые `dev`/`build` загружают `.env` в дочерние процессы. Самостоятельный запуск приложения
из `apps/web` или `apps/api` не равнозначен запуску workspace: потребуются те же переменные.
API не открывает CORS для прямого произвольного доступа браузеров; Web читает его на сервере.

## Режим PostgreSQL

После восстановления Docker Desktop либо подключения своей отдельной development-БД:

```sh
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm db:seed
```

`db:migrate` применяет готовые миграции к `DATABASE_URL`, без reset.
`db:seed` требует `DEMO_CATALOG=true`, непроизводственное окружение и локальный адрес БД;
добавляет четыре помеченных demo-аниме, без аккаунтов и профилей.
Затем можно выставить `DEMO_CATALOG=false` в приватном `.env` и перезапустить `pnpm dev`.
Это проверка чтения БД, а не импорт старых данных; `/users/soul` без отдельной записи профиля вернёт 404.

Compose хранит данные в именованных volumes. Остановка без удаления данных:

```sh
docker compose --env-file .env -f infra/compose.dev.yaml stop
```

На этой машине Docker пока недоступен; последние симптомы и ограничения записаны в
[статусе миграции](../migration/STATUS.ru.md). В demo-режиме `/api/health` возвращает 200,
а `/api/ready` может возвращать 503: demo не доказывает работоспособность PostgreSQL.

## Команды и проверки

| Команда                                                 | Что делает                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm setup`                                            | Создаёт приватную локальную конфигурацию, не перезаписывая её                                   |
| `pnpm dev`                                              | Сборка серверных пакетов и запуск трёх сервисов                                                 |
| `pnpm build`                                            | Generate → contracts → database → API → Web → Admin                                             |
| `pnpm typecheck`                                        | Строгие типы всех пяти package-проектов                                                         |
| `pnpm lint`                                             | ESLint с `packages/config/eslint.config.mjs`                                                    |
| `pnpm format` / `pnpm format:check`                     | Prettier; конфигурация `packages/config/prettier.json`, исключения в корневом `.prettierignore` |
| `pnpm test`                                             | Существующие тесты на уже собранных пакетах                                                     |
| `pnpm docs:check`                                       | Проверка локальных Markdown-ссылок в README, docs, apps, packages, scripts, infra и tests       |
| `pnpm check`                                            | Build → typecheck → lint → test → docs:check                                                    |
| `pnpm audit --audit-level high`                         | Отдельная проверка зависимостей; актуальность требует доступа к registry                        |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Генерация клиента / применение миграций / development-наполнение                                |

Используйте корневой `pnpm build`: он передаёт окружение сборкам Next.js без переноса
`--env-file` в параметры их workers. Проверки HTML используют отдельные порты 18020–18022,
чтобы не останавливать открытый предпросмотр.

Сейчас 9 тестов: 8 не требуют PostgreSQL, один интеграционный пропускается без `TEST_DATABASE_URL`.
Для него заранее создаётся отдельная локальная БД `animesoul_test`, и в отдельном терминале
`DATABASE_URL` и `TEST_DATABASE_URL` направляются только в неё; затем выполняются `pnpm db:migrate`
и `pnpm check`. Не направляйте этот тест в рабочую или production-базу.
В [quality.yml](../../.github/workflows/quality.yml) CI создаёт PostgreSQL test-service,
применяет миграцию и задаёт обе переменные: интеграционный тест там должен выполняться.

## Куда складывать файлы

Изменения продукта — в `apps`, общие контракты и конфигурации — в `packages`, документация — в `docs`.
Утилиты разделены на `scripts/workspace`, `scripts/quality`, `scripts/windows`.
Локальные отчёты/скриншоты/сборки — в игнорируемый `artifacts`, секреты — в приватный `.env`.
`node_modules`, `.next`, `dist`, `generated` и `.idea` — локальные служебные файлы.
Старый код и базы не возвращаются в корень нового `main`; восстановление выполняется отдельно по
[инструкции](../migration/STATUS.ru.md#восстановление).
