[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Текущая защита

Проверено по `main` 7 октября 2026 года. [Карта границ](../architecture/PROJECT_MAP.ru.md) ·
[Маршруты и видимость](../architecture/SITE_MAP.ru.md) · [Данные](../architecture/DATA_MODEL.ru.md).

Реализованы локальные аккаунты, авторизация владельца и admin MFA. Публичный production-выпуск требует последующих этапов.

Реализованы: проверка ввода/DTO, ограниченные параметризованные запросы Prisma, серверная приватность,
no-store, отказ от доверия proxy-заголовкам, предел тела 64 KiB, лимит 120 запросов/минуту/IP,
защитные заголовки API/сайта, отключённая индексация, admin API с отдельной сессией, ролью и MFA, приватные настройки и lockfile.

Лимит хранится в одном процессе и использует настоящий IP соединения. Перед несколькими репликами и Cloudflare
нужны Redis и явно настроенный доверенный proxy. Клиентские forwarded-заголовки не служат доказательством IP.

При SSR запросы к API приходят с IP сервера Next.js и делят этот лимит.
Это текущая локальная граница, а не законченная инфраструктура для нескольких реплик/Cloudflare.

Проверки доступности, здоровья и готовности не расходуют общий лимит. DEV-переключатель доступа
использует отдельный лимит 60 запросов/минуту/IP, чтобы запросы страницы не мешали вернуться
к настоящей роли. Проверки роли, origin и CSRF сохраняются.
У чтения текущего аккаунта и подписки отдельные лимиты по 120 запросов/минуту/IP:
запросы страницы не должны превращать восстановленный аккаунт или плеер в гостевой.

| Защита                                                  | Где реализована                                                       | Проверка / ограничение                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Тело 64 KiB, rate limit, Helmet, запрет admin, no-store | `apps/api/src/app.ts`                                                 | `apps/api/tests/api.test.mjs`; лимит в одном процессе         |
| Проверка окружения и запрет production-demo             | `apps/api/src/config.ts`                                              | API-тест конфигурации; production-БД ещё не развёрнута        |
| Публичность/блокировка и ограниченные запросы           | `apps/api/src/catalog/catalog.service.ts`                             | Интеграционный тест БД; локально требует отдельный PostgreSQL |
| Удаление скрытых полей и преобразование invisible       | `packages/contracts/src/profiles.ts`                                  | Тесты приватности и собранного HTML                           |
| Проверка входа/выхода DTO                               | Controller, `packages/contracts`, `apps/web/lib/api.ts`               | API- и HTML-тесты                                             |
| Metadata, безопасный JSON-LD, ограничения индексации    | `apps/web/lib/site.ts`, `app` страницы/robots/sitemap                 | `tests/seo.test.mjs`, `tests/website.test.mjs`                |
| Ограничения frame/type/referrer; noindex admin          | `apps/web/next.config.ts`, `apps/admin/next.config.ts`                | Это не полный nonce-CSP для будущего плеера                   |
| Секреты и воспроизводимость                             | `.gitignore`, `.env.example`, `scripts/workspace/setup.mjs`, lockfile | `.env`, старые БД и подпись не добавляются в Git              |

`badge` — оформление, а не роль. Сессии и роли проверяются сервером; admin требует свою audience и MFA.
Worker каталога, пресеты и загрузка медиа профилей работают; реальные платежи, Cloudflare и S3 ещё впереди.

Транзитивные зависимости Prisma 7.10 исправлены адресными pnpm overrides: deepmerge-ts 8.0.2
для @prisma/config и mysql2 3.24.5 для CLI. Изменения deepmerge 8 относятся к Map и merge-into;
наша конфигурация состоит из обычных объектов. С исправлениями повторно проверяются validate, generate,
schema diff и сборка. При обновлении Prisma пересмотреть overrides.
Источники: [deepmerge](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[изменения релиза](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[MySQL](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).

Следующие условия: append-only права аудита, медиа/SSRF, nonce CSP, распределённые лимиты,
sandbox-платежи, нагрузка и Cloudflare. До выполнения условий публичный выпуск не готов.

## Граница embed-просмотра

Сервер использует только фиксированные API-origin, запрет redirect, ограниченные ответы/кеш и повторную проверку переключателя. Embed допускает только доверенные HTTPS-домены без credentials/нестандартного порта; клиентский URL не проксируется сервером. Iframe запускается по действию пользователя с sandbox без popups, top-navigation и downloads. Это пока не заменяет полный nonce-CSP, проверку декодирования и публичную инфраструктуру.

## Авторизация этапа 2

Argon2id, хеши и сроки сессий, Origin/CSRF, владелец библиотеки, явный bootstrap owner и admin MFA реализованы.
Резервные коды одноразовые; TOTP counter проверяется атомарно; секрет зашифрован с привязкой к UUID.
Попытки входа ограничены в PostgreSQL; Argon2 concurrency ограничен. Next.js proxy читает до 64 KiB и разрешает только свои маршруты.
API по-прежнему не доверяет forwarded-заголовкам; локальный IP Next.js общий.
Проверки: `tests/accounts.test.mjs`, `apps/api/tests/security.test.mjs`, `pnpm db:verify`.
[Подробности и границы](../operations/ACCOUNTS.ru.md).

## Google и почта

OAuth state привязан к браузерной HttpOnly cookie, имеет срок 10 минут и атомарно потребляется до обмена code. PKCE verifier зашифрован AES-GCM; nonce/RS256/issuer/audience/exp/iat/verified email проверяются через jose. Фиксированные origins Google; redirect запрещён. Привязка требует действующей web-сессии и пароль, не выполняется по совпадению почты. Email-токены хешированы, ограничены сроком и authVersion, атомарно потребляются; смена/сброс отзывают обе audiences. SMTP требует TLS; file mode запрещён в production. Безопасные пресеты проверяются allowlist. Интеграции: `tests/identity.test.mjs`; реальный Google/SMTP ещё требует внешней проверки. Социальные privacy/NSFW/block/anti-abuse правила пока целевые: [социальный план](../architecture/SOCIAL_NETWORK_PLAN.ru.md).

## Git и контейнерные сборки

`pnpm secrets:check` проверяет исходники на известные форматы токенов и значения
приватных локальных env-файлов; `--staged` проверяет весь индекс без вывода секретов.
`.gitignore` исключает env-файлы, ключи и дампы; `.dockerignore` исключает env-файлы
и ключи из сборки. Ручная публикация GHCR использует временный `GITHUB_TOKEN`.
[Процедура и ограничения](../operations/GITHUB.ru.md).
