[English](DOCKER.md) | [Русский](DOCKER.ru.md)

# Запуск в Docker и развёртывание на сервере

[compose.yaml](../../compose.yaml) запускает PostgreSQL 18, миграции Prisma, API,
обработчик каталога, сайт и админку. Node.js и pnpm установлены внутри образов.
Сайт и админка работают из собранных Next.js standalone-приложений. На компьютере
достаточно Docker Desktop с Linux-контейнерами; на сервере — Docker Engine и Compose 2.24.4+.

## Локальный запуск

На этой машине база уже перенесена из native PostgreSQL. Для существующего `.env`:

```sh
docker compose up -d --build --wait
```

На Windows [Start AnimeSoul.bat](../../scripts/windows/Start%20AnimeSoul.bat) выполняет
эту команду и открывает браузер. Окно можно закрыть: контейнеры продолжают работать.
Если `.env` отсутствует, [Setup Docker.ps1](../../scripts/windows/Setup%20Docker.ps1)
создаёт его с новым случайным паролем и MFA-ключом. Существующий файл сохраняется.
Для первого запуска на Linux скопируйте [.env.example](../../.env.example) в `.env`,
замените оба вхождения пароля результатом `openssl rand -hex 24` и задайте
`MFA_ENCRYPTION_KEY` результатом `openssl rand -hex 32`.

| Сервис                          | Адрес                   |
| ------------------------------- | ----------------------- |
| Сайт                            | `http://localhost:8021` |
| Админка                         | `http://localhost:8022` |
| API                             | `http://127.0.0.1:8020` |
| PostgreSQL для локальных утилит | `127.0.0.1:54329`       |

Compose переопределяет адрес БД на `postgres:5432`, адрес API для фронтендов — на
`http://api:8020`, `LOCAL_POSTGRES=false`, `DEMO_CATALOG=false`. Ключи провайдеров,
MFA и остальные приватные параметры поступают из `.env` при запуске и не входят
в образы. Локальный API использует `APP_ENV=development`, разрешающий HTTP localhost
и тестовую почту в `artifacts/dev-mail`; фронтенды используют production-сборки.
Пустая новая БД получает схему, но аккаунты и каталог автоматически не создаются.

```sh
docker compose ps -a
docker compose logs -f --tail=100
docker compose stop
docker compose up -d --wait
```

После изменения исходников повторите `up -d --build --wait`: это пересобирает
образы. Для быстрого обновления при разработке можно остановить Docker-приложения
(`docker compose stop web admin api worker`) и использовать `pnpm dev` с базой Docker.
[Start AnimeSoul Dev.bat](../../scripts/windows/Start%20AnimeSoul%20Dev.bat) сохраняет
прежний запуск с Node.js 24/pnpm. Не запускайте оба набора приложений на одних портах.

Миграции запускаются до API/worker; фронтенды ждут успешной проверки `/api/ready`.
`migrate` со статусом `Exited (0)` — штатное завершение, а не ошибка.
Проверки фронтендов `/api/health` остаются доступны при включённом обслуживании сайта.

## Постоянные данные и команды

| Хранилище              | Содержимое                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| Volume `postgres`      | Каталог, пользователи, аккаунты, библиотека, очередь и настройки |
| Volume `profile-media` | Загруженные изображения профилей                                 |
| Volume `diagnostics`   | Общие журналы API, сайта и админки                               |
| `artifacts/dev-mail`   | Только локальная тестовая почта                                  |

`docker compose down` удаляет контейнеры и сеть, сохраняя volumes.
`docker compose down -v` удаляет данные; это не команда обычной остановки.
Снимок образа не является резервной копией базы или файлов пользователей.

```sh
docker compose exec api node apps/worker/main.mjs --enqueue
docker compose logs -f worker
docker compose run --rm migrate
```

Redis — дополнительное быстрое хранилище/кэш. Код сейчас не обращается к нему:
очередь каталога хранится в PostgreSQL. При необходимости он включается командой
`docker compose --profile cache up -d --wait`; его порт не публикуется на компьютере.

## Перенос существующей native-базы

Для другой Windows-машины с native PostgreSQL 18, `.env` и базой `animesoul` на
`127.0.0.1:54329` сначала остановите старые приложения, затем выполните:

```sh
docker compose build
docker compose create postgres
```

Пока native-база занимает 54329, временно уберите локальную публикацию порта
PostgreSQL из Compose или используйте override с `ports: !reset []`, затем запустите
только `postgres`. До миграций новая Docker-база должна оставаться пустой.

```sh
node --env-file=.env scripts/docker/migrate-native.mjs
```

Утилита сохраняет custom-format `pg_dump` и JSON-отчёт в `artifacts/database-backups`,
восстанавливает данные одной транзакцией и сравнивает точное количество строк
во всех таблицах. Если Docker-база уже содержит таблицы, перенос прекращается.
Исходный кластер сохраняется. Затем остановите native PostgreSQL, восстановите
публикацию порта Docker, задайте `LOCAL_POSTGRES=false` в `.env` и запустите весь стек.
При наличии локальных файлов профиля перенесите их в `profile-media` и сохраните
исходный `MFA_ENCRYPTION_KEY`: смена ключа делает прежние MFA-секреты недоступными.

## Сервер с HTTPS

[compose.server.yaml](../../compose.server.yaml) добавляет Caddy, убирает прямую
публикацию API, БД и фронтендов, включает строгую production-конфигурацию API/worker.
Снаружи доступны только 80/443. Caddy направляет основной домен на сайт, отдельный
домен — на админку и автоматически получает/обновляет TLS-сертификаты.

1. Скопируйте [.env.server.example](../../.env.server.example) в `.env.server`.
2. Задайте настоящие `SITE_DOMAIN`/`ADMIN_DOMAIN` и соответствующие HTTPS
   `SITE_URL`/`ADMIN_URL`, приватный hex-пароль БД, сохранённый MFA-ключ и нужные ключи
   провайдеров. Адреса сайта и админки должны иметь разные hostname.
3. Направьте DNS обоих доменов на сервер и откройте 80/443. Для почтовой доставки
   задайте `MAIL_MODE=smtp` и SMTP-параметры; `file` в production запрещён.
4. Запустите из корня проекта:

```sh
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml up -d --build --wait
```

На новом сервере отдельно восстановите резервную копию БД и файлы профилей.
Перед каждым обновлением сохраняйте `pg_dump`, volume `profile-media` и приватную
конфигурацию. Например, без shell-перенаправления бинарных данных:

```sh
docker compose exec postgres pg_dump -U animesoul -d animesoul -Fc -f /tmp/animesoul.dump
docker compose cp postgres:/tmp/animesoul.dump ./artifacts/database-backups/animesoul.dump
```

Для серверных команд используйте те же `--env-file` и оба `-f`, что и при запуске.
Резервные копии храните также вне сервера. `PUBLIC_INDEXING=true` включает индексацию
только после настройки публичного HTTPS и настоящего каталога.

Подготовлена конфигурация развёртывания; фактический выпуск на публичном сервере
и получение сертификатов требуют сервера, доменов и DNS.

## Образы на GitHub

[GitHub/GHCR](GITHUB.ru.md) описывает ручную публикацию образов и запуск
через `compose.ghcr.yaml` без локальной сборки. Dockerfile остаётся в `infra/docker/`.
