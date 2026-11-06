[English](SELF_HOSTING.md) | [Русский](SELF_HOSTING.ru.md)

# Как развернуть AnimeSoul у себя

Инструкция для новой установки на собственном Linux-сервере. Для локального компьютера
с Docker Desktop см. [локальный запуск](DOCKER.ru.md); для готовой приватной тестовой
сборки с каталогом, начальным владельцем и полной runtime-конфигурацией — [Docker Hub dev-box](DEV_IMAGE.ru.md).

## Что подготовить

- Docker Engine с Linux-контейнерами и Docker Compose **2.24.4 или новее**, Git, OpenSSL.
- Сервер `linux/amd64`, два домена: например, `anime.example.com` и `admin.example.com`.
- DNS A/AAAA обоих доменов, указывающие на сервер. Публикуйте AAAA только при рабочем IPv6.
- Входящие TCP 80/443; UDP 443 необязателен для HTTP/3. API и PostgreSQL наружу не открываются.
- Доступ к исходникам и, при выборе готовых образов, к GitHub Packages этого репозитория.

Node.js и pnpm для обычного Docker-запуска не нужны. Развёртывание не переносит чужую
базу, аккаунты, медиа и ключи. Публичный сайт требует собственного каталога и настройки
разрешённых источников просмотра.

## 1. Получить исходники и создать приватные настройки

```sh
git clone --branch main https://github.com/Quidden/AnimeSoul.git
cd AnimeSoul
umask 077
test -f .env.server || cp .env.server.example .env.server
chmod 600 .env.server
```

Откройте `.env.server` в редакторе и заполните:

| Переменная                     | Значение                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `SITE_DOMAIN`, `ADMIN_DOMAIN`  | Два разных имени без `https://` и без пути                                   |
| `SITE_URL`, `ADMIN_URL`        | Соответствующие полные адреса с `https://`                                   |
| `POSTGRES_PASSWORD`            | Новый результат `openssl rand -hex 24`                                       |
| `MFA_ENCRYPTION_KEY`           | Для новой БД — результат `openssl rand -hex 32`; при переносе — прежний ключ |
| `INTERNAL_PROXY_SECRET`        | Ещё один независимый результат `openssl rand -hex 32`, общий для web/API     |
| `INTERNAL_PROXY_TRUSTED_HOSTS` | `web` для проверки внутреннего Docker-соединения                             |
| `MAIL_MODE`                    | `smtp` с заполненными SMTP-параметрами либо `disabled` без отправки писем    |

Сохраните `ANIMESOUL_ENV_FILE=.env.server`, `APP_ENV=production`, `DEMO_CATALOG=false`
и `PUBLIC_INDEXING=false`. `DATABASE_URL` для контейнеров формируется Compose из
пароля и внутреннего адреса PostgreSQL; вручную добавлять его в серверный шаблон не нужно.

Ключи `KODIK_TOKEN`, `YUMMY_TOKEN`, `KODIK_PRIVATE_KEY`, `TRACE_MOE_API_KEY`, OAuth/SMTP
задаются только здесь. Источник просмотра требует соответствующего `ALLOW_*` и ключа;
пустые необязательные параметры можно оставить пустыми. `GIPHY_API_KEY` — публичный
ключ браузерной интеграции, остальные приватные ключи в браузер не передаются.
Для Google OAuth callback: `https://<SITE_DOMAIN>/api/auth/google/callback`.
`INTERNAL_PROXY_SECRET` не превращает произвольные клиентские forwarded-заголовки
в доверенные: канал используется для подписанной идентичности поиска по кадру.

## 2. Выбрать готовые образы или сборку на сервере

Приложение публикуется в **GHCR**, а отдельный приватный dev-box — в **Docker Hub**.
Для обычного сервера используйте четыре GHCR-образа либо соберите их из исходников.

Для GHCR откройте [Publish containers](https://github.com/Quidden/AnimeSoul/actions/workflows/publish-containers.yml)
и выберите успешно завершённый запуск для нужного коммита `main`. Все четыре задания
`api`, `web`, `admin`, `migrate` должны пройти. Добавьте в `.env.server`:

```dotenv
ANIMESOUL_IMAGE_TAG=sha-<полный-40-символьный-SHA-коммита>
```

Замените весь пример действительным тегом. `latest` не публикуется. Для приватных
пакетов выполните `docker login ghcr.io` и введите токен с `read:packages` в запросе
пароля; не вписывайте его в команду, `.env.server` или репозиторий.

Следующие команды используйте в Bash из корня проекта. Функция сохраняет одинаковые
аргументы окружения/Compose для запуска, диагностики и обновления:

```sh
dc() { docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml "$@"; }
dc config --quiet
dc pull
dc up -d --no-build --wait --wait-timeout 300
```

Если GHCR недоступен или нужна собственная сборка, вместо предыдущего блока:

```sh
dc() { docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml "$@"; }
dc config --quiet
dc up -d --build --wait --wait-timeout 300
```

Повторно определяйте выбранную функцию после нового SSH-входа. Compose запускает БД,
применяет миграции, поднимает API/worker, сайт и админку, затем Caddy получает HTTPS.
Миграции со статусом `Exited (0)` завершились успешно.

## 3. Проверить запуск и наполнить сайт

```sh
dc ps -a
dc logs --tail=100 api web admin caddy
dc exec api node /app/healthcheck.mjs http://127.0.0.1:8020/api/ready
curl --fail https://anime.example.com/api/health
curl --fail https://admin.example.com/api/health
```

В `curl` замените домены на свои. Если Caddy не получил сертификат, проверьте DNS,
доступность 80/443 и его журнал. Если API не готов, проверьте завершение миграций
и состояние PostgreSQL. Не публикуйте полный `docker compose config`: он раскрывает
значения окружения; `config --quiet` проверяет файл без вывода ключей.

Новая БД содержит схему без пользователей и каталога. Зарегистрируйте личный аккаунт
на `/account`; включите MFA в разделе безопасности. Первый владелец назначается
явной операторской командой из [инструкции аккаунтов](ACCOUNTS.ru.md#административный-доступ),
собранной локальной копией и доступом к БД через loopback/SSH-туннель. API не выдаёт
права владельца за первую регистрацию. Не открывайте порт PostgreSQL в интернет.

Далее [настройте каталог](CATALOG.ru.md) через админку. При готовых ключах импорт можно
запустить командой `dc exec api node apps/worker/main.mjs --enqueue`; наблюдение:
`dc logs -f worker`. Без собственного каталога сайт может быть пустым. При переносе
существующей установки восстановите БД и `profile-media`, сохранив MFA-ключ.
Подробности: [Docker и данные](DOCKER.ru.md), [админка](ADMINISTRATION.ru.md).

## 4. Обновление, резервная копия и остановка

До обновления сохраните БД, `profile-media` и приватную конфигурацию также вне сервера:

```sh
mkdir -p artifacts/database-backups
dc exec postgres pg_dump -U animesoul -d animesoul -Fc -f /tmp/animesoul.dump
dc cp postgres:/tmp/animesoul.dump ./artifacts/database-backups/animesoul.dump
```

Копируйте backup в отдельное защищённое хранилище; имя выше переиспользуется. Отдельно
сохраните содержимое тома `profile-media` и `.env.server`. Для обновления исходников
выполните `git pull --ff-only`; для GHCR измените `ANIMESOUL_IMAGE_TAG`, затем
`dc pull` и `dc up -d --no-build --wait --wait-timeout 300`. Для собственной сборки —
`dc up -d --build --wait --wait-timeout 300`. Миграции применятся перед запуском API.
Возврат к старому тегу не отменяет миграции БД: восстановление backup планируйте вместе
с версией приложения. `dc stop` останавливает стек; `dc down` сохраняет тома.
`dc down -v` удаляет данные и не используется для обычного обновления.

## Защита `.env` и ключей

В Git разрешены только `.env.example` и `.env.server.example` с пустыми значениями
или примерами. Реальные `.env*`, ключи, дампы и `artifacts` исключены из Git;
Docker-контекст исключает приватные env-файлы, в том числе во вложенных папках.
В готовые образы ключи поступают только при запуске. Не передавайте секреты через
`ARG`, `NEXT_PUBLIC_*`, Docker labels, скриншоты или логи Actions.

Перед своим коммитом проверьте `git status`, `pnpm secrets:check`, после добавления
файлов — `pnpm secrets:check --staged`. Эти Node.js-команды предназначены для рабочей
копии разработчика. GitHub Actions повторяет проверку перед публикацией GHCR.
При уже опубликованном ключе отзовите/замените его: одного удаления файла недостаточно.

Разрешайте `PUBLIC_INDEXING=true` только после проверки HTTPS, каталога и настроек
приватности. Реальные платежи подключаются отдельным этапом.
