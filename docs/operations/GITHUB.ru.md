[English](GITHUB.md) | [Русский](GITHUB.ru.md)

# GitHub: исходники и контейнерные образы

TypeScript-сайт публикуется из `main` в [Quidden/AnimeSoul](https://github.com/Quidden/AnimeSoul).
Прежнее приложение сохранено в `master` и архивных ссылках. GPL-лицензия, добавленная в
`master`, сохранена. Смена основной ветки GitHub не запускает сайт и не переносит данные.

Автоматический workflow `quality.yml` удалён. Push и pull request не запускают тесты проекта
в GitHub Actions. Сами тесты доступны локально через `pnpm check`; прежние запуски Actions
остаются в истории.

## Публикация образов приложения

Откройте **Actions → Publish containers → Run workflow**, выберите **main** и запустите вручную.
[publish-containers.yml](../../.github/workflows/publish-containers.yml) собирает четыре образа
`linux/amd64` из [infra/docker/Dockerfile](../../infra/docker/Dockerfile). Dockerfile остаётся
в этой папке: workflow явно указывает его путь. Для GHCR используются временный `GITHUB_TOKEN`
и право `packages: write`; персональный токен реестра и ключи провайдеров не нужны.
Версии Actions закреплены по SHA коммитов. Перед сборкой проверяются секреты в исходниках.

| Образ                               | Назначение                                   |
| ----------------------------------- | -------------------------------------------- |
| `ghcr.io/quidden/animesoul-api`     | API и обработчик с разными командами запуска |
| `ghcr.io/quidden/animesoul-web`     | Собранный сайт                               |
| `ghcr.io/quidden/animesoul-admin`   | Собранная админка                            |
| `ghcr.io/quidden/animesoul-migrate` | Разовое применение миграций Prisma           |

Успешная сборка получает тег `sha-<полный SHA коммита>`. Используйте его после успешного
завершения всех четырёх заданий. Изменяемого тега `latest` нет. Метки исходников и ревизии
связывают Packages с репозиторием. Публикация не запускает сервисы, не создаёт аккаунты
и не восстанавливает БД. Новые GHCR-пакеты по умолчанию приватные; видимость и доступ
настраиваются в GitHub Packages. Для приватного скачивания выполните `docker login ghcr.io`
с аккаунтом/токеном с правом `read:packages`. Токен хранится в хранилище учётных данных Docker.

Приватный dev-box с каталогом из [DEV_IMAGE](DEV_IMAGE.ru.md) собирается отдельно.
Локальные дампы, исходные аккаунты и ключи провайдеров отсутствуют в GitHub checkout
и не входят в образы приложения этого workflow.

## Запуск опубликованной версии

Подготовьте приватное окружение по [инструкции Docker](DOCKER.ru.md), затем добавьте
`ANIMESOUL_IMAGE_TAG=sha-<полный SHA коммита>` в `.env` или `.env.server`.
[compose.ghcr.yaml](../../compose.ghcr.yaml) заменяет сборку приложений на образы реестра,
сохраняя БД, постоянные тома, проверки готовности и порядок запуска.

Локально:

```sh
docker compose -f compose.yaml -f compose.ghcr.yaml pull
docker compose -f compose.yaml -f compose.ghcr.yaml up -d --no-build --wait
```

Сервер с HTTPS:

```sh
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml pull
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml up -d --no-build --wait
```

Для дальнейших операций используйте те же аргументы окружения и файлов. Прежние команды
локальной сборки продолжают работать. До обновления сохраните БД и медиа профилей;
выбор старого образа не отменяет миграции БД. В форке можно задать
`ANIMESOUL_GHCR_REPOSITORY=owner/repository` в нижнем регистре, соответствующем именам пакетов.

## Перед коммитом

Для нового сервера используйте отдельную [инструкцию самостоятельной установки](SELF_HOSTING.ru.md).
Образы приложения публикуются в GHCR; приватный dev-box с каталогом остаётся на Docker Hub.
`pnpm check` включает проверку секретов. Сканер также распознаёт PAT Docker Hub и встроенные
доступы внутреннего proxy; вложенные `.env*` исключены из Docker-контекста.

```sh
pnpm secrets:check
pnpm secrets:check --history
git add <проверенные пути>
pnpm secrets:check --staged
git diff --cached --check
```

В Git входят только шаблоны `.env.example` и `.env.server.example`. Приватные `.env*`,
ключи, файлы БД, artifacts, логи и загруженные медиа остаются вне репозитория. Проверка
сканирует рабочие файлы либо весь индекс на распространённые форматы токенов/приватных
ключей и точные секретные значения из локальных приватных env-файлов. В выводе только
имена файлов, номера строк и названия переменных. Проверка не заменяет просмотр изменений
и не распознаёт любой неизвестный секрет. `.dockerignore` исключает приватные env-файлы
и файлы ключей; доступы передаются при запуске контейнеров.

Документация GitHub: [публикация Docker-образов](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
и [Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
