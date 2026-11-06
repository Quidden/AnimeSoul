[English](DEV_IMAGE.md) | [Русский](DEV_IMAGE.ru.md)

# Приватный тестовый образ

`quiddens/animesoul-dev:dev` содержит текущий сайт, админку, API, worker и PostgreSQL 18 в одном Linux-контейнере. Образ собирается для `linux/amd64`. Это отдельное тестовое окружение с полным снимком локального каталога, а не сервер разработки Next.js с горячим обновлением кода.

При первом запуске в отдельный Docker-том восстанавливаются аниме, персонажи, связи, эпизоды, идентификаторы провайдеров и тарифы. Создаётся начальный `DevOwner` / `dev-owner@example.test` с ролями `owner` и `admin`, полными правами и доступом к native-плееру. Пароль, секрет TOTP и ключ шифрования MFA генерируются при запуске. Вход в админку сохраняет MFA. Остальные аккаунты регистрируются обычным способом и не получают административных прав. Аккаунты, друзья, посты, комментарии, библиотека, медиа и подписки работают на той же реализации, что и обычный стек сайта.

Исходные аккаунты, история просмотра, платежи, сессии, личные медиа, аудит, `.env` и ключи провайдеров не входят в образ. Локальные изображения из `apps/web/public` включаются при сборке; удалённые постеры остаются ссылками, как на текущем сайте. Видео и внешние сервисы требуют ключей при запуске.

## Запуск опубликованного образа

В каталоге проекта:

```powershell
docker login
docker compose -f compose.dev-image.yaml pull
docker compose -f compose.dev-image.yaml up -d --wait
docker exec animesoul-dev node /app/api/dev-box/account.mjs
```

Последняя команда показывает email, пароль, текущий шестизначный код админки и URI для приложения-аутентификатора. Код действует до конца текущего 30-секундного интервала и используется один раз. Если код истёк, выполни команду повторно. Данные входа не печатаются в логи контейнера. `DEV_ACCOUNT_PASSWORD` можно передать при первом запуске через `docker run -e DEV_ACCOUNT_PASSWORD=...`; после создания тома изменение этой переменной не сбрасывает пароль.

- Сайт: <http://localhost:18021>.
- Админка: <http://localhost:18022>.
- API: <http://localhost:18020/api/ready>.

Compose подключает только перечисленные runtime-настройки из локального `.env`: провайдеры просмотра, trace.moe, GIPHY, Google OAuth и SMTP. Адрес исходной базы и её пароль не передаются. Источники доступны, когда соответствующий `ALLOW_KODIK` / `ALLOW_YUMMY` включён и ключ задан; их можно отключить в админке. Для другого компьютера ключи нужно задать там отдельно. В Compose другой адрес задаётся через `DEV_SITE_URL`, `DEV_ADMIN_URL` и соответствующие привязки портов. База внутри контейнера доступна только по loopback и не публикует порт 5432.

Для отдельной приватной конфигурации скопируйте `.env.example` в `.env.dev-image`
(существующий файл сохраните), заполните ключи сервисов и используйте эти аргументы
для всех операций:

```sh
docker compose --env-file .env.dev-image -f compose.dev-image.yaml pull
docker compose --env-file .env.dev-image -f compose.dev-image.yaml up -d --wait
```

`ALLOW_KODIK_DIRECT` с приватным ключом включает прямой HLS; `GIPHY_API_KEY` — GIF-пикер;
оба Google-параметра — OAuth; `MAIL_MODE=smtp` и SMTP-настройки — отправку писем.
`MAIL_MODE=file` сохраняет локальные тестовые письма в постоянном томе. Google callback:
`<DEV_SITE_URL>/api/auth/google/callback` (по умолчанию `http://localhost:18021/api/auth/google/callback`).
Внутренний канал proxy использует общий случайный runtime-секрет и доверяет только
loopback между встроенными web/API; явно заданный `INTERNAL_PROXY_SECRET` заменяет его.
Ключ MFA и пароль PostgreSQL привязаны к приватному тому. `DEV_APP_ENV=production`
требует разных HTTPS-хостов сайта/админки и запрещает file-почту и фиксированный IP зрителя.
Обычное развёртывание с Caddy/HTTPS описано в [самостоятельной установке](SELF_HOSTING.ru.md).
Функции, ещё не реализованные в основном сайте, включая реальные платежи, остаются недоступны.

```powershell
docker compose -f compose.dev-image.yaml stop
docker compose -f compose.dev-image.yaml start
docker compose -f compose.dev-image.yaml logs --tail=100
```

Аккаунты, библиотеки, настройки и изменения каталога сохраняются в томе `animesoul-dev-image_dev-data`. Обычный `down` сохраняет том. Команда `down -v` удаляет все данные этого окружения; следующий запуск создаст новый пароль и нового владельца. Новый тег образа не заменяет каталог в существующем томе: встроенный снимок используется только при первом запуске пустой базы. До старта API Prisma применяет новые миграции схемы. Прежний индекс ограничения одного аккаунта удаляется без удаления пользователей и сброса данных владельца. Перед обновлением сохраните резервную копию тома.

## Как собрать тот же образ

Основной локальный PostgreSQL должен быть запущен. Команда экспорта читает контейнер `animesoul-postgres-1`; другой контейнер можно задать переменной `DEV_SNAPSHOT_CONTAINER`.

```powershell
node scripts/docker/snapshot-dev-catalog.mjs
docker build --platform linux/amd64 --target dev-box -t quiddens/animesoul-dev:dev -t quiddens/animesoul-dev:dev-20261106 -f infra/docker/Dockerfile .
docker compose -f compose.dev-image.yaml up -d --pull never --wait
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
docker compose -f compose.dev-image.yaml restart
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
```

Экспорт использует `pg_dump` с явным списком разрешённых таблиц. Схема хранится отдельно от данных. Скрипт сравнивает количество строк до/после экспорта и записывает SHA-256 в `artifacts/dev-image/manifest.json`. Перед запуском контейнер проверяет эти суммы, восстанавливает схему, данные и ограничения в одной транзакции и сверяет количество строк. Текущая база не изменяется.

`Dockerfile` повторно использует стадии сборки API и standalone-сборки Next.js. В финальную стадию на базе PostgreSQL 18 копируются Node.js 24, готовые приложения, снимок и скрипт запуска. Он запускает PostgreSQL, API, worker, сайт и админку, завершает все процессы при сбое одного и аккуратно останавливает базу последней. Healthcheck проверяет все три HTTP-сервиса. Контейнер работает от пользователя `postgres`, без root и дополнительных Linux capabilities.

`.dockerignore` исключает приватные файлы, зависимости и прочие артефакты; из `artifacts` разрешены только два dump-файла и манифест. Сам каталог не хранится в Git. Проверка образа проверяет снимок, отсутствие исходных личных данных, вход владельца/MFA, административные API, native-доступ, регистрацию обычного пользователя, дружбу, посты и ответы. Запускайте её только на отдельном проверочном томе: она создаёт свой дополнительный аккаунт и публикации.

## Как опубликовать приватно

Снимок от 6 ноября 2026 года содержит 13 142 аниме, 1 244 персонажа и 1 766 связей
состава, со схемой `202611020001_community_content`. Существующие тома dev-box сохраняют
данные и получают новые миграции. Для независимого просмотра встроенного снимка
датированный образ можно запустить с новым отдельным томом рядом с прежним окружением:

```sh
docker run -d --name animesoul-dev-20261106 --mount type=volume,src=animesoul-dev-20261106,dst=/var/lib/postgresql -e SITE_URL=http://localhost:28021 -e ADMIN_URL=http://localhost:28022 -p 127.0.0.1:28020:8020 -p 127.0.0.1:28021:8021 -p 127.0.0.1:28022:8022 quiddens/animesoul-dev:dev-20261106
docker exec animesoul-dev-20261106 node /app/api/dev-box/account.mjs
```

Будет создан новый случайный тестовый аккаунт; изменения из прежнего тома не переносятся.
Доступен весь реализованный функционал; внешние интеграции требуют runtime-ключей,
как описано выше. Обычный стек из нескольких контейнеров с HTTPS разворачивается по
[инструкции самостоятельной установки](SELF_HOSTING.ru.md).

```powershell
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev --prepare-only
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev-20261106
```

Скрипт использует сохранённый вход Docker Desktop через credential helper. Токены обрабатываются только в памяти и не попадают в файлы, логи или образ. Если репозитория нет, создаёт его через Docker Hub API с `is_private: true`. Перед `docker push` и после него повторно проверяет приватность; в публичный репозиторий отправка запрещена. После публикации проверяет тег, подтверждает отказ в анонимном скачивании и сохраняет digest в `artifacts/dev-image/published-<tag>.json`.

Репозиторий: <https://hub.docker.com/r/quiddens/animesoul-dev>. Для скачивания требуется авторизованный аккаунт с доступом к этому приватному репозиторию. Новый образ выпускай с новым датированным тегом; `dev` можно обновлять для текущей тестовой версии.

Справка Docker: [создание приватного репозитория](https://docs.docker.com/docker-hub/repos/create/), [API создания репозитория](https://docs.docker.com/reference/api/hub/latest/operations/CreateRepository/), [API токена доступа](https://docs.docker.com/reference/api/hub/latest/operations/AuthCreateAccessToken/).
