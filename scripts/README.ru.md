[English](README.md) | [Русский](README.ru.md)

# Утилиты проекта

Публичные команды находятся в [package.json](../package.json) и запускаются из корня через pnpm.

| Папка       | Файлы                                                          | Назначение                                                                            |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `workspace` | `setup.mjs`                                                    | Один раз создаёт приватный `.env`                                                     |
| `workspace` | `build.mjs`, `run.mjs`                                         | Последовательная сборка пакетов и приложений; использует pnpm CLI текущего запуска    |
| `workspace` | `dev.mjs`                                                      | Компиляция серверной основы, запуск API/Web/Admin и завершение только своих процессов |
| `workspace` | `dev-status.mjs`                                               | Проверка портов и распознавание уже работающего AnimeSoul                             |
| `workspace` | `open-development-site.mjs`                                    | Открытие браузера после готовности локальных серверов                                 |
| `quality`   | `check-docs.mjs`                                               | Проверка локальных Markdown-ссылок без обхода зависимостей и generated-файлов         |
| `windows`   | [Start AnimeSoul.bat](windows/Start%20AnimeSoul.bat)           | Запуск полного Docker-стека, ожидание готовности и открытие сайта                     |
| `windows`   | [Start AnimeSoul Dev.bat](windows/Start%20AnimeSoul%20Dev.bat) | Прежний запуск Node.js/pnpm для разработки                                            |
| `windows`   | [Setup Docker.ps1](windows/Setup%20Docker.ps1)                 | Создание отсутствующего `.env` без установки Node.js                                  |
| `docker`    | `migrate-native.mjs`                                           | Резервная копия native-базы и перенос в пустую БД Docker с проверкой всех таблиц      |

Это поддерживаемые утилиты, не временные эксперименты. Результаты проверок, скриншоты
и локальные выгрузки складываются в игнорируемый `artifacts`, документация — в `docs`.
Подробные команды и требования — в [локальной разработке](../docs/operations/LOCAL_DEVELOPMENT.ru.md).
Запуск контейнеров и сервер с HTTPS — в [Docker](../docs/operations/DOCKER.ru.md).

`pnpm secrets:check` запускает `quality/check-secrets.mjs` для проверки кандидатов Git без
вывода секретов. `--staged` проверяет индекс, `--history` — неопубликованные коммиты HEAD.
[Ручная поставка GitHub/GHCR](../docs/operations/GITHUB.ru.md).

Команды этапа 2: `profiles:import` (`migrate-profiles.mjs`) и `account:operator` (`account-operator.mjs`);
[аккаунты и одноразовая привязка](../docs/operations/ACCOUNTS.ru.md). `setup` также добавляет отсутствующий MFA-ключ.

Этап 3: `catalog:sync` и `catalog:worker` запускают `apps/worker/main.mjs`; очередь/курсор хранятся в PostgreSQL. `providers:switch` использует общую с admin политику и приостанавливает импорт при выключении Kodik. [Инструкция](../docs/operations/CATALOG.ru.md).

`demo:community` создаёт 100 вымышленных локальных аккаунтов и осмысленную активность;
`demo:community verify` проверяет все пароли. Повторный seed не сбрасывает изменения.
[Условия, файлы доступа и сценарии](../docs/operations/DEMO_COMMUNITY.ru.md).
