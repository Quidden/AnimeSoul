[English](SITE_MAP.md) | [Русский](SITE_MAP.ru.md)

# Карта сайта и API

Проверено 8 октября 2026. Сайт: http://localhost:8021; API: http://127.0.0.1:8020; admin: http://localhost:8022.
Публичные страницы получают DTO сервером; клиентские операции идут через ограниченные Next.js proxy.

| URL                                       | Поведение                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| /                                         | Реальное продолжение просмотра, полка текущих просмотров и популярные                               |
| /catalog                                  | Полки популярных/онгоингов/новинок/высоких оценок, фильтры и случайный выбор                        |
| /catalog/:section, /catalog/genres/:genre | Отдельные страницы разделов/жанров, пагинация и подбор по просмотренным жанрам                      |
| /anime/:slug/franchise                    | Опубликованные связанные тайтлы по точным ID и текущий тайтл                                        |
| /characters/:slug                         | Портрет, имена, описание, сэйю и появления персонажа в опубликованных аниме                         |
| /anime/:slug                              | SSR-метаданные, embed-плеер, серии/озвучки, любимое, оценка и папка                                 |
| /users/:username                          | Публичный профиль для гостей; владельцу и друзьям — разрешённые блоки; недоступный профиль даёт 404 |
| /account                                  | Вход, регистрация, привязка старого профиля, редактирование, приватность, пароль и настройка MFA    |
| /library                                  | Приватная библиотека, папки, заметки, оценки сезонов/серий и перенесённый прогресс                  |
| /friends                                  | Поиск пользователей, друзья, заявки, подписки, подписчики и блокировки; требуется вход              |
| /robots.txt /sitemap.xml                  | Локально noindex/disallow и пустой sitemap; публичная индексация зависит от согласий и HTTPS        |
| admin /                                   | Вход с ролью/MFA; провайдеры, очередь импорта и проверка ID                                         |

Шапка ведёт в каталог, аккаунт, библиотеку и раздел друзей. Demo-кнопка soul существует только при DEMO_CATALOG=true
и не даёт сессию. Из библиотеки опубликованные тайтлы ведут к просмотру; перенесённые неопубликованные
записи ждут обновления каталога. Профиль содержит якоря profile-favorites, profile-collections,
profile-ratings и profile-statistics только для доступных блоков.

Каталог принимает q (до 100 символов), genre, status (released/ongoing/announced), sort (popular/rating/rating-asc/title/newest/oldest),
format, translation, group, excludeGenre, ratingSource/minRating, personalized,
from/to (1900–2200) и page. Все фильтры применяются до пагинации.
Параметры фильтра дают noindex и canonical /catalog.

## API

`GET /api/catalog/random?mode=all|filtered|taste` выбирает опубликованный тайтл;
taste и личные оценки требуют web-сессию. `GET /api/anime/:slug/related` возвращает
опубликованные точные соответствия франшизы. Персональные выборки не индексируются.

| Маршруты                                                                           | Доступ и назначение                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GET /api/health, /api/ready                                                        | Liveness; readiness требует PostgreSQL и возвращает 503 при недоступности |
| GET /api/catalog?q=…                                                               | Публичный каталог                                                         |
| GET /api/anime/:slug                                                               | Публичные метаданные                                                      |
| GET /api/anime/:slug/characters, /api/characters/:slug                             | Состав персонажей тайтла и общие страницы персонажей                      |
| GET /api/anime/:slug/playback                                                      | Актуальные разрешённые iframe, никаких provider secrets                   |
| GET /api/profiles/:username                                                        | Отфильтрованный публичный DTO                                             |
| GET /api/sitemap/catalog, /api/sitemap/profiles                                    | Только опубликованные/индексируемые записи                                |
| POST /api/auth/register, /api/auth/login, /api/auth/claim                          | Origin и собственный заголовок; выдача web cookie                         |
| GET /api/auth/me                                                                   | Свой UUID/почта/имя/роли, статус MFA и CSRF; требует web session          |
| POST /api/auth/logout, /api/auth/logout-all, /api/auth/password                    | Отзыв сессий и смена пароля; Origin/CSRF                                  |
| POST /api/auth/mfa/begin, /api/auth/mfa/confirm                                    | Подтверждённая настройка MFA; секрет выдаётся только владельцу            |
| GET/POST /api/account/profile                                                      | Свой приватный профиль и редактирование                                   |
| GET/POST /api/account/library                                                      | Своя библиотека; изменение любимого/оценки                                |
| POST /api/account/ratings                                                          | Оценка сезона/серии                                                       |
| POST /api/account/folders, /api/account/folders/delete, /api/account/folders/entry | Папки владельца, заметки и принадлежность                                 |
| POST /api/account/progress                                                         | Позиция/длительность и завершение серии; без video URL                    |
| POST /api/admin/auth/login                                                         | Admin Origin, credentials, явная роль и MFA; отдельная cookie             |
| GET /api/admin/auth/me, POST /api/admin/auth/logout, GET /api/admin                | Отдельная административная сессия, роль и MFA                             |

Все ответы no-store. Мутации аккаунта требуют web session, Origin, X-AnimeSoul-Request и session-bound CSRF.
UUID владельца берётся из сессии: тело и x-role его не задают. Admin-пути проверяются до обработки,
кроме входа, который проверяет пароль/роль/MFA сам. Next.js web proxy не пропускает admin-пути;
admin proxy не пропускает web account-пути. Входящие потоки ограничены 64 KiB.
API и клиентские DTO: [контракты](../../packages/contracts/src/account.ts).

## Индексация и следующие адреса

PUBLIC_INDEXING=false означает noindex, disallow и пустой sitemap. Включение требует реальных данных
и публичного HTTPS. Профиль дополнительно требует публичности и отдельного согласия владельца.
Sitemap исключает фильтры, account, library, admin и demo. Metadata/JSON-LD строятся только по публичным DTO.
Медиа-загрузка/GIF, отдельные публичные коллекции,
платежные callbacks и остальное управление пользователями/модерацией ещё не реализованы.

[Аккаунты](../operations/ACCOUNTS.ru.md) · [Просмотр](../operations/PLAYBACK.ru.md) · [Данные](DATA_MODEL.ru.md).

## Управление каталогом

GET /api/anime/:slug/playback использует Kodik, затем включённый резерв; ?provider=yummy отклоняется. Общий резерв требует владельца или явного делегирования и admin MFA.
GET /api/catalog/by-ids принимает до 100 UUID и выдаёт только опубликованные метаданные.
GET /api/admin/catalog?page=1 возвращает состояние провайдеров, последние задания и очередь конфликтов.
POST /api/admin/providers/switch, /api/admin/catalog/import, /api/admin/catalog/job и
/api/admin/catalog/resolve требуют admin audience, роль, MFA, Origin/CSRF и причину.
[Контракты](../../packages/contracts/src/catalog-admin.ts) · [Операции](../operations/CATALOG.ru.md).

## Идентичность и будущие социальные маршруты

`GET /api/auth/options` сообщает доступность Google/почты без credentials. `POST /api/auth/email/verify` и `/email/change` требуют владельца, Origin/CSRF; `/email/confirm`, `/password/request-reset`, `/password/reset` — Origin и собственный заголовок. `POST /api/auth/google/start` начинает login/link; link требует сессии, CSRF и пароль. `GET /api/auth/google/callback` проверяет state/browser/PKCE/nonce и выдаёт web cookie. Next callback перенаправляет на `/account`, не сохраняя code/state в URL. Пресеты сохраняются через `/api/account/profile`; `/api/auth/me` включает avatar, публичность, emailVerified, hasPassword и googleLinked.

`/community`, фильтр хештегов и страницы постов реализованы ниже. Сообщения и комнаты совместного просмотра остаются в плане: [План соцсети](SOCIAL_NETWORK_PLAN.ru.md).

## Серии и прогресс

`/anime/:slug/episodes/:episodeId?t=125` — SSR-страница серии с canonical без таймкода, TVEpisode и ссылками.
API `GET /api/anime/:slug/episodes` и `/episodes/:id` выдаёт только опубликованные серии без видео URL.
`GET /api/anime/:slug/stream?source=<ID>` выдаёт временный direct DTO или embed fallback, без приватного ключа.
`GET /api/account/playback/:animeId`, `POST /api/account/playback/session` и `/progress` работают только для
владельца; записи требуют Origin/CSRF. `/episodes/sitemap-index.xml` перечисляет 256 частей
`/episodes/sitemap/:bucket.xml`; API читает `/api/sitemap/episodes/:bucket` (0–255), только реальные опубликованные серии.
[Настройка и границы плеера](../operations/PLAYBACK.ru.md).

## Друзья и закрытые профили

/friends — поиск пользователей, заявки, друзья, подписки и блокировки, noindex. /users/:username учитывает владельца, дружбу и блокировку при наличии web-сессии; гостям доступны только публичные разделы. Якорь profile-friends появляется при разрешённом списке. API account/social и account/profiles описаны в [инструкции](../operations/FRIENDS.ru.md). Metadata/JSON-LD используют только гостевые данные; авторизованный HTML noindex.

## Первые обсуждения этапа 6

`/community` — публикации по времени, `/community?tag=…` — фильтр хештега, `/posts/:id` — пост
и ответы. На страницах аниме/серии — связанные посты и обсуждение; в профиле — разрешённые
посты, рецензии и история комментариев. Все читают одни Post/Comment. SEO обсуждений закрыто.
API и ограничения: [публикации](../operations/CONTENT.ru.md). [100 тестовых аккаунтов](../operations/DEMO_COMMUNITY.ru.md).

## Административные маршруты

`/`, `/analytics`, `/activity`, `/features`, `/users`, `/journal`, `/plans`, `/promotions`,
`/subscription-history`, `/announcements`, `/notifications`, `/anime-notices`, `/catalog`,
`/winter`, `/maintenance`, `/templates`, `/system`, `/admin-journal`, `/diagnostics` используют общий защищённый layout и noindex.

[API и правила работы](../operations/ADMINISTRATION.ru.md).
