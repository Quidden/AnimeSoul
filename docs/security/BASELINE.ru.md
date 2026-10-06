[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Текущая защита

Проверено по `main` 6 октября 2026 года. [Карта границ](../architecture/PROJECT_MAP.ru.md) ·
[Маршруты и видимость](../architecture/SITE_MAP.ru.md) · [Данные](../architecture/DATA_MODEL.ru.md).

Это ранняя основа, ещё не production-авторизация.

Реализованы: проверка ввода/DTO, ограниченные параметризованные запросы Prisma, серверная приватность,
no-store, отказ от доверия proxy-заголовкам, предел тела 64 KiB, лимит 120 запросов/минуту/IP,
защитные заголовки API/сайта, отключённая индексация, закрытый admin API, приватные настройки и lockfile.

Лимит хранится в одном процессе и использует настоящий IP соединения. Перед несколькими репликами и Cloudflare
нужны Redis и явно настроенный доверенный proxy. Клиентские forwarded-заголовки не служат доказательством IP.

При SSR запросы к API приходят с IP сервера Next.js и делят этот лимит.
Это текущая локальная граница, а не законченная защита по аккаунтам/пользователям.

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

`badge` — оформление, а не проверка роли. Схемы `Session`, `UserRole` и `Entitlement`
не означают действующую авторизацию. Admin отвечает 401 на API; его HTML — только сообщение.
Нет endpoint загрузки, GIF-поиска или платежа; premium-проверки для этих будущих функций пока отсутствуют.
Cloudflare, распределённые лимиты, worker и S3 ещё не подключены.

Транзитивные зависимости Prisma 7.10 исправлены адресными pnpm overrides: deepmerge-ts 8.0.2
для @prisma/config и mysql2 3.24.5 для CLI. Изменения deepmerge 8 относятся к Map и merge-into;
наша конфигурация состоит из обычных объектов. С исправлениями повторно проверяются validate, generate,
schema diff и сборка. При обновлении Prisma пересмотреть overrides.
Источники: [deepmerge](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[изменения релиза](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[MySQL](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).

Следующие условия: Argon2id, хеши/сроки сессий, CSRF/Origin, права владельца, MFA, bootstrap владельца,
права append-only аудита, проверка медиа/SSRF, nonce CSP с плеером, распределённые лимиты,
подписи/идемпотентность sandbox-платежей, поиск секретов, модель угроз, восстановление PostgreSQL,
нагрузка, Cloudflare и закрытие origin. До выполнения условий публичный выпуск не готов.
