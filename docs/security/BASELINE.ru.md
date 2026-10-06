[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Текущая защита

Это ранняя основа, ещё не production-авторизация.

Реализованы: проверка ввода/DTO, ограниченные параметризованные запросы Prisma, серверная приватность,
no-store, отказ от доверия proxy-заголовкам, предел тела 64 KiB, лимит 120 запросов/минуту/IP,
защитные заголовки API/сайта, отключённая индексация, закрытый admin API, приватные настройки и lockfile.

Лимит хранится в одном процессе и использует настоящий IP соединения. Перед несколькими репликами и Cloudflare
нужны Redis и явно настроенный доверенный proxy. Клиентские forwarded-заголовки не служат доказательством IP.

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
