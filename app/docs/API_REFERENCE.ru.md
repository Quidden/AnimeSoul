[English](API_REFERENCE.md) | [Русский](API_REFERENCE.ru.md)

# API AnimeSoul и используемые внешние поля

Справочник описывает фактические контракты версии 0.2.7. Все внутренние URL
относительные: в production их обслуживает тот же FastAPI origin, в разработке
Vite проксирует их на `http://127.0.0.1:8000`.

После запуска FastAPI также публикует OpenAPI UI по `/docs` и JSON-схему по
`/openapi.json`. Ручной документ дополнительно фиксирует frontend-потребителей,
условные поля и upstream-структуры.

## Общие правила

- JSON request bodies отправляются с `Content-Type: application/json`.
- Ошибки FastAPI/Pydantic обычно имеют форму `{"detail": ...}`.
- Watch Party использует отдельную стабильную форму
  `{"error": "...", "code": "..."}`.
- Production работает same-origin. CORS разрешён только для локальных Vite
  origin `http://127.0.0.1:5173` и `http://localhost:5173`, с credentials.
- Внутренний API не требует пользовательской авторизации: он рассчитан на
  локальный процесс. При публикации backend наружу требуется отдельный security
  review.

Полный список **46** маршрутов с ссылками на Python-обработчики и все поля Pydantic-моделей: [API_SCHEMA.ru.md](API_SCHEMA.ru.md). Таблица генерируется из исходников. Ниже описаны динамические ответы и ограничения.

## Сводка основных маршрутов

| Метод | Путь | Назначение | Backend | Основной frontend-потребитель |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | готовность и идентификация runtime | `backend/app/main.py` | `run.py`, `launcher.py` |
| `GET` | `/api/storage` | чтение полного сохранения | `api/storage.py` | `useProfileStorage` |
| `PUT` | `/api/storage` | атомарная запись и optional autosync | `api/storage.py` | `saveStorageDocument` |
| `GET` | `/api/yummy` | proxy catalog/details/videos/trailers/schedule/ping | `api/yummy.py` | catalog/tracking/player/header |
| `GET` | `/api/kodik` | проверка доступности Kodik | `api/kodik.py` | settings/diagnostics |
| `GET` | `/api/episode-dates/{mal_id}` | календарные даты выхода эпизодов | `api/episode_dates.py` | карточки серий |
| `POST` | `/api/kodik/stream` | прямые качества, субтитры и skip-сегменты | `api/kodik.py` | `AnimeSoulPlayer` |
| `GET` | `/api/community-ratings` | пакет/публичная страница агрегатов | `api/community_ratings.py` | ratings feature |
| `GET` | `/api/community-ratings/{anime_id}` | один агрегат | `api/community_ratings.py` | внешний клиент/диагностика |
| `PUT` | `/api/community-ratings/{anime_id}` | заменить анонимное дерево оценки | `api/community_ratings.py` | ratings feature |
| `POST` | `/watch-party/create` | создать комнату | `api/watch_party.py` | `useWatchParty` |
| `POST` | `/watch-party/join` | присоединиться | `api/watch_party.py` | `useWatchParty` |
| `POST` | `/watch-party/update` | heartbeat и playback command | `api/watch_party.py` | `useWatchParty` |
| `POST` | `/watch-party/transfer-host` | передать роль хоста | `api/watch_party.py` | `useWatchParty` |
| `GET` | `/watch-party/state` | авторитетный снимок комнаты | `api/watch_party.py` | `useWatchParty` |
| `POST` | `/watch-party/leave` | покинуть комнату | `api/watch_party.py` | `useWatchParty` |
| `GET` | `/health` | версия Watch Party protocol | `api/watch_party.py` | совместимость/диагностика |
| `WS` | `/ws/watch-party/{room_id}` | push-снимки комнаты | `api/watch_party.py` | текущий frontend не подключается |
| `GET` | `/api/gdrive/status` | OAuth/cloud/sync status | `api/gdrive.py` | settings |
| `POST` | `/api/gdrive/credentials` | сохранить OAuth client | `api/gdrive.py` | settings |
| `GET` | `/api/gdrive/auth-url` | начать OAuth | `api/gdrive.py` | settings |
| `GET` | `/api/gdrive/oauth2callback` | принять Google redirect | `api/gdrive.py` | popup → opener message |
| `POST` | `/api/gdrive/sync` | явная sync-команда | `api/gdrive.py` | settings |
| `POST` | `/api/gdrive/disconnect` | удалить локальные tokens | `api/gdrive.py` | settings |

## System API

### `GET /api/health`

Ответ:

```json
{
  "ok": true,
  "stack": "FastAPI + React",
  "version": "0.2.7",
  "capabilities": ["kodik-direct-stream-v1"],
  "runtimeInstanceId": "optional-instance-id"
}
```

`runtimeInstanceId` присутствует только при непустой environment-переменной
`ANIMESOUL_INSTANCE_ID`. Launcher сопоставляет его с локальным runtime state и
только после этого разрешает остановку процесса.

## Storage API

### `GET /api/storage`

Входных полей нет. Ответ — полный `StorageDocument`. Если файла нет даже после
попытки первого импорта legacy, возвращается `404`:

```json
{"detail": "Save file does not exist"}
```

Frontend при `404` строит документ из localStorage mirror и сразу выполняет
`PUT`.

### `PUT /api/storage`

Body — полный StorageDocument. Query: `auto_sync=true`, `folder_mode=visible` (`visible|appdata`), `prefer_watched=true`.

`validate_storage_document` требует object, непустой profiles array, object-профили с непустыми строковыми id и object snapshot. Если activeProfile указан, такой ID обязан существовать. Невалидная оболочка → 422. Доменные поля мигрирует frontend; неизвестные поля сохраняются.

```json
{"saved":true,"path":"C:\\...\\data\\animesoul-storage.json","cloud_sync_scheduled":false,"cloud_sync_blocked":false}
```

Общий lock на физический путь сериализует запись через temp/replace. `path` — локальная диагностика. Облачная работа запускается после локальной записи, только с tokens и без `choice_pending`. Это серверная защита: старый клиент не обходит первый выбор. Scheduled не означает uploaded; итог читается из Drive status.

Frontend instant/interval/manual управляет auto_sync. Interval выполняет `useHeaderCloudSync`; manual отправляет в облако только по кнопке. Локальный файл сохраняется во всех режимах. Ошибка/повреждение чтения не равны 404 и не разрешают bootstrap поверх данных. Подробности: [DATA_MODEL.ru.md](DATA_MODEL.ru.md), [GDRIVE_SYNC.ru.md](GDRIVE_SYNC.ru.md).

## YummyAnime proxy


### Проверка и сохранение токена

`GET /api/yummy/credentials` возвращает `{"configured":boolean}` без токена. `POST /api/yummy/credentials` принимает `{"token":"public-token"}` (1–512 символов), проверяет минимальный запрос Yummy, атомарно пишет `api-credentials.json` и очищает gateway cache. Ответ содержит `configured`, `saved`, `checks[]` с field/label/status/detail. Отклонённый токен → 422, недоступная проверка → 502.

### `GET /api/yummy`

Общие query-поля:

| Поле | Тип | Default/ограничение | Использование |
| --- | --- | --- | --- |
| `mode` | string | `catalog` | ветка proxy |
| `id` | integer/null | `null` | один anime ID для `videos`, `trailers` |
| `ids` | comma-separated string | `""`, первые 50 непустых элементов; лишние отбрасываются | пакет `details` |
| `limit` | integer | `24`, 1–48 | catalog/search |
| `offset` | integer | `0`, не меньше 0 | catalog/search |
| `q` | string | `""` | поисковая строка |
| `refresh` | boolean | `false` | пропустить fresh cache; stale остаётся аварийным резервом |

Неизвестный `mode` попадает в поведение `catalog`.

#### `mode=catalog`

Маршрут вызывает `HybridCatalogueService.catalogue`: YummyAnime и Kodik дополняют отсутствующие данные друг друга. `details` и `videos` также используют гибридный сервис и постоянный реестр идентичности. Поля `_sources` и заголовки `X-AnimeSoul-Yummy-Status` / `X-AnimeSoul-Kodik-Status` показывают результат каждого источника. Ping, trailers и schedule обращаются к Yummy напрямую.


Upstream без `q`: `GET https://api.yani.tv/anime?limit=&offset=`.

Upstream с `q`: `YummyAnimeGateway.search` строит до четырёх вариантов
(исходный запрос, исправленная раскладка, транслитерация, известные псевдонимы),
выполняет их параллельно и возвращает первую непустую страницу. Backend cache —
5 минут/до 128 записей с объединением одинаковых in-flight запросов; frontend
cache первой страницы поиска — 5 минут/до 40 записей.

Все публичные ответы провайдеров дополнительно проходят через общий SQLite
cache `animesoul-response-cache.sqlite3`. Детали и трейлеры живут 12 часов,
каталог/поиск — 5–10 минут, серии — 20 минут, расписание — 5 минут. После fresh
TTL запись ещё доступна как stale-if-error: краткий сбой YummyAnime или Kodik
не превращает уже известный каталог/плеер в пустой ответ. Ключ провайдера входит
в cache key только как SHA-256 fingerprint.

Ответ:

```json
{"anime": [], "hasMore": false, "_sources": {"yummy":"ok","kodik":"unused"}}
```

`hasMore` вычисляется как `anime.length === limit`, а не из upstream total.

#### `mode=details`

Для каждого непустого элемента `ids`, максимум 50, выполняется параллельный
`GET /anime/{id}`. Ошибка отдельного элемента исключает только его из результата.

```json
{"anime": [], "_sources": {"yummy":"ok","kodik":"unused"}}
```

#### `mode=videos`

Требует `id`, иначе `400`. Параллельно выполняет `GET /anime/{id}`,
`GET /anime/{id}/videos` и Kodik lookup с `with_episodes_data`; одинаковые
in-flight запросы объединяются.

```json
{"anime": {}, "videos": [], "episode_identity_version": 1, "_sources": {"yummy":"ok","kodik":"ok"}}
```

Текущий typed frontend helper `fetchAnimeVideos` использует `videos`, а
`anime` в составном ответе доступен другим/старым потребителям.

Kodik lookup проверяет принадлежность результатов конкретному тайтлу:
разные Shikimori ID не объединяются, общий Kinopoisk/IMDb ID франшизы
недостаточен, резервный поиск по названию требует точного совпадения с
проверкой доступных года и типа. Поле Yummy `original`, если оно обозначает
«Ранобэ»/«Манга», не используется как название. Пустой сериал без серий
не превращается в серию 1. `episode_identity_version: 1` вместе с успешными
`_sources.yummy` и `_sources.kodik` позволяет tracking однократно исправить
старую базу номеров для этого тайтла.

#### `mode=trailers`

Требует `id`, иначе `400`. Upstream: `GET /anime/{id}/trailers`.

```json
{"trailers": []}
```

Frontend рекурсивно нормализует разные формы trailer payload; точные ключи
перечислены ниже.

#### `mode=schedule`

Upstream: `GET /anime/schedule`.

```json
{"schedule": []}
```

#### `mode=ping`

Выполняет минимальный `GET /anime?limit=1&offset=0` и возвращает измерение
только upstream-времени:

```json
{"ok": true, "upstreamMs": 137}
```

Query `silent=1`, который отправляет `Header.tsx`, router не объявляет и не
использует; FastAPI просто игнорирует его.

#### Ошибки proxy

- прямой Yummy-запрос без токена: `503`; гибридный каталог может использовать Kodik fallback;
- недоступен гибридный каталог: `502` с диагностическими заголовками источников;
- `httpx.HTTPError`: `502`, `YummyAnime API is temporarily unavailable`;
- отсутствует `id` для нужной ветки: `400`.

Upstream headers формируются только на backend:

| Header | Значение |
| --- | --- |
| `X-Application` | локально настроенный Public token |
| `Lang` | `ru` |
| `Accept` | `application/json` |

Gateway извлекает поле upstream `response` и рекурсивно превращает строки,
начинающиеся с `//`, в `https://...`.

## Даты выхода серий

`GET /api/episode-dates/{mal_id}?page=1` возвращает
`{"dates":{"1":"2026-04-03"},"hasNextPage":false}`. Используется явный
`remote_ids.myanimelist_id` конкретной части; номер серии берётся из
`originNumber`, до объединения частей в сезон. Даты поступают из поля `aired`
[Jikan / MyAnimeList](https://docs.api.jikan.moe/#tag/anime/operation/getAnimeEpisodes),
сохраняются как календарные `YYYY-MM-DD`, без сдвига на часовой пояс устройства.
Пагинация: `page` от 1 до 100. Ошибка источника без сохранённых данных — `503`.

Запросы дат выполняются отдельно от загрузки видео, только для раскрытых
сезонов с сериями. Одинаковые запросы объединяются; частота ограничена одним
запросом в 1,05 секунды, кэш действителен час и сохраняется при временном сбое.
Повторная попытка после ошибки — не чаще раза в минуту.

Ответ `mode=videos` также может содержать у каждого видео `episode_added_at`:
раннюю известную дату добавления этой серии в Yummy (Unix seconds, одинаковую
для разных озвучек). Она используется только с подписью «Добавлена», когда нет
даты выхода. Kodik `updated_at` не используется как дата серии. При отсутствии
обеих дат карточка показывает «Дата выхода неизвестна».

## Kodik direct playback

### `POST /api/kodik/stream`

Body описывает уже выбранную серию и озвучку. `iframeUrl` используется backend
как исходная ссылка для подписи, а stable ID и названия позволяют найти точный
`/seria/` URL через каталог Kodik:

```json
{
  "videoId": 123,
  "season": 1,
  "episode": "7",
  "originEpisode": "7",
  "dubbing": "AniLibria",
  "translationId": 610,
  "iframeUrl": "https://kodik.example/season/...",
  "sourceId": "77",
  "sourceIdType": "shikimori",
  "sourceTitle": "Название",
  "sourceOriginalTitle": "Original title"
}
```

Ответ не содержит публичного/приватного ключа, подписи или IP:

```json
{
  "sources": [
    {"quality": 720, "src": "https://cdn.example/video.m3u8", "type": "hls"}
  ],
  "subtitles": [
    {"src": "https://cdn.example/ru.vtt", "label": "Русские", "language": "ru"}
  ],
  "skips": {
    "opening": {"time": 12, "length": 85},
    "ending": {"time": 1320, "length": 80}
  }
}
```

`sources` всегда непустой при успехе и отсортирован от большего качества к
меньшему. `subtitles` и `skips` могут быть пустыми. Закрытый ключ читается из
защищённого локального файла Kodik settings; если пара ключей отсутствует или
не удалось получить точный `/seria/`, `/video/` или `/movie/` URL, запрос
завершается ошибкой: ссылки `/serial/` и `/season/` никогда не передаются в
`/api/video-links`. Каждый запуск онлайн-плеера заново получает временные
`sources`; frontend не кэширует и не сохраняет их. Запрос всегда включает
`auto_proxy=true` и `skip_segments=true`, поэтому Kodik может выбрать
прокси-ссылку по IP пользователя и вернуть сегменты опенинга/эндинга. `force_proxy`
не используется.
upstream отклоняет подпись, маршрут возвращает `422` с безопасным `detail`.

### `GET /api/kodik?mode=ping`

Проверяет публичный каталог Kodik и возвращает `ok` и `upstreamMs`. Другие
значения `mode` дают `400`.

## Реально используемые поля YummyAnime

Это не полная схема поставщика, а поля, которые читает текущий frontend.
Незнакомые поля проходят через proxy, но не имеют гарантированного потребителя.

### Anime

| Поле | Тип | Для чего используется |
| --- | --- | --- |
| `anime_id` | number | первичный ID, ключ прогресса/рейтинга/папок, запрос details/videos |
| `title` | string | основное имя, поиск, отображение, franchise key |
| `original` | string? | альтернативное имя и поиск |
| `other_titles` | string[] или string? | расширенный поиск |
| `title_en`, `title_ru` | string? | поиск и отображение вариантов |
| `description` | string? | экран просмотра/hero |
| `year` | number? | фильтр и метаданные |
| `season` | number? | группировка/метаданные сезона |
| `poster.big`, `poster.fullsize` | string? | карточка, hero, preview fallback |
| `rating.average` | number? | рейтинг YummyAnime и сортировка |
| `rating.counters` | number? | получено в контракте; исключается из списка score sources |
| `rating.kp_rating` | number? | Кинопоиск |
| `rating.imdb_rating` | number? | IMDb |
| `rating.anidub_rating` | number? | AniDub |
| `rating.myanimelist_rating` | number? | MyAnimeList |
| `rating.worldart_rating` | number? | World Art |
| `rating.shikimori_rating` | number? | Shikimori |
| `rating.<unknown_rating>` | number? | показывается как дополнительный источник, если ключ содержит `rating` и значение > 0 |
| `genres[].title` | string | жанровый фильтр и статистика |
| `genres[].alias` | string | доменный контракт жанра |
| `type.name`, `type.shortname` | string? | подпись формата |
| `type.alias` | string? | movie/OVA/ONA/special classification |
| `type.value` | number? | дополнительный upstream type ID |
| `data.index` | number? | порядок просмотра внутри франшизы |
| `data.text` | string? | дополнительная upstream-подпись порядка |
| `views` | number? | метаданные/сортировка, когда доступны |
| `anime_status.value`, `.title`, `.alias` | number/string? | статус выхода и badge |
| `viewing_order[]` | `Anime[]`? | восстановление состава/порядка франшизы |
| `random_screenshots[]` | screenshot[]? | preview серий и slideshow |

Поля `franchiseCount` и `franchiseEntries` присутствуют в типе `Anime`, но это
внутреннее обогащение presentation-слоя, а не обязательные upstream-поля.

### Screenshot

| Поле | Тип | Использование |
| --- | --- | --- |
| `time` | number? | время кадра/сортировка preview |
| `id` | number? | идентификация кадра |
| `episode` | string? | сопоставление с серией |
| `sizes.small` | string? | компактное preview |
| `sizes.full` | string? | полноразмерный кадр |

### Video

| Поле | Тип | Использование |
| --- | --- | --- |
| `video_id` | number | dedup источников |
| `iframe_url` | string | встраивание и Kodik adapter |
| `number` | string | идентификатор серии |
| `date` | number? | release tracking |
| `duration` | number? | прогресс, статистика и auto-next |
| `data.dubbing` | string | название озвучки |
| `data.player` | string | название/тип источника |
| `data.player_id` | number или string? | устойчивое определение провайдера/перевода |
| `data.translation_id` | number или string? | устойчивое определение озвучки |
| `data.translation_type` | string? | voice/subtitles и другие типы перевода Kodik |
| `skips.opening.time` | number | начало опенинга |
| `skips.opening.length` | number | длина опенинга |
| `skips.ending.time` | number | начало эндинга |
| `skips.ending.length` | number | длина эндинга |

`originAnimeId`, `originNumber`, `contentKind`, `contentTitle` добавляет
`Player.tsx` при объединении элементов франшизы; upstream их не обязан
возвращать.

### ScheduleEntry

| Поле | Тип | Использование |
| --- | --- | --- |
| `anime_id` | number | связь расписания с тайтлом |
| `episodes.aired` | number? | уже вышедшее количество |
| `episodes.count` | number? | ожидаемое общее количество |
| `episodes.next_date` | number? | следующая дата выхода |
| `episodes.prev_date` | number? | предыдущая дата выхода |

### Trailer payload

Upstream-форма не фиксирована. `normalizeTrailers` рекурсивно ищет:

- YouTube ID: `youtube_id`, `youtubeId`, `video_id`;
- URL: `iframe_url`, `embed_url`, `trailer_url`, `youtube_url`, `url`, `link`,
  `video`, `src`;
- подпись: `title`, `name`;
- poster: `poster`, `image`, `thumbnail`.

YouTube URL превращается в `https://www.youtube-nocookie.com/embed/{id}`, poster
fallback — `https://i.ytimg.com/vi/{id}/maxresdefault.jpg`. Прямые
`.mp4/.webm/.ogg` имеют kind `video`, остальные URL — `embed`; URL картинок как
trailer отбрасываются.

## Community Ratings API

### `GET /api/community-ratings`

Query:

| Поле | Ограничение | Поведение |
| --- | --- | --- |
| `ids` | до 100 уникальных положительных integer через запятую | вернуть только запрошенные агрегаты |
| `limit` | 1–100, default 100 | размер публичной страницы, когда `ids` пуст |
| `offset` | >= 0, default 0 | смещение публичной страницы |

Ответ:

```json
{
  "ratings": {
    "123": {
      "animeId": 123,
      "title": "Название",
      "anime": {"average": 8.25, "count": 4},
      "seasons": {"1": {"average": 8.0, "count": 2}},
      "episodes": {"1:3": {"average": 9.0, "count": 1}},
      "updatedAt": 1786665600000
    }
  },
  "hasMore": false,
  "offset": 0
}
```

При `ids` поле `hasMore` всегда `false`. Без `ids` записи сортируются по
последней публикации, затем по `anime_id`.

### `GET /api/community-ratings/{anime_id}`

`anime_id` должен быть > 0. Ответ: `{"rating": aggregate|null}`.

### `PUT /api/community-ratings/{anime_id}`

Body:

| Поле | Тип/ограничение |
| --- | --- |
| `title` | string, trim, максимум 300 символов |
| `anime` | number 1–10 или `null` |
| `seasons` | object `{positiveIntegerString: score}`, максимум 200 ключей |
| `episodes` | object `{"<season>:<episode>": score}`, максимум 5000 ключей; regex `^\d+:.{1,40}$` |

Score не может быть boolean/NaN/Infinity и должен лежать в 1–10. Сервер читает
или создаёт UUID cookie `animesoul_rating_voter` (`HttpOnly`, `SameSite=Lax`,
год, Secure только на HTTPS). Полное дерево заменяет предыдущую оценку этого
browser/anime; полностью пустое дерево удаляет запись.

Ответ:

```json
{"rating": null, "anonymous": true}
```

или новый aggregate вместо `null`. Идентификаторы голосующих никогда не
выдаются наружу.

## Watch Party API

Все эти HTTP/WS-маршруты, включая `/health`, отключены при `ANIMESOUL_MOBILE=android`. Комнаты живут в памяти процесса и исчезают при перезапуске.

Protocol version: **2**. Session в frontend:

```json
{"roomId": "A1B2C3", "token": "uuid", "role": "host"}
```

Она хранится в `sessionStorage` под `animesoul:watch-party-session`.

### `POST /watch-party/create`

Body: `name` (fallback `Хост`, обрезается до 32) и `roomMode` (`shared` либо
fallback `host`). Ответ:

```json
{"roomId": "A1B2C3", "token": "uuid", "role": "host", "protocol": 2}
```

### `POST /watch-party/join`

Body: `roomId`, `name` (fallback `Участник`, до 32), `mode` (`free` либо
fallback `follow`). Ответ аналогичен create с ролью `guest`. Код комнаты
нормализуется к upper case.

### `POST /watch-party/update`

Body-поля:

| Поле | Назначение |
| --- | --- |
| `roomId` | код комнаты |
| `token` | participant ID/token |
| `name` | актуальное имя, до 32 |
| `mode` | `follow` или `free` |
| `roomMode` | `host`/`shared`; изменить может только текущий host heartbeat |
| `playback` | текущий `PartyPlayback` |
| `buffering` | boolean состояния участника |
| `control` | строго `true`, если участник shared-комнаты публикует управление |
| `action` | optional `{type: string, ...}`; сервер добавляет монотонный `seq` |

`PartyPlayback`:

| Поле | Тип |
| --- | --- |
| `animeId` | number |
| `season` | number |
| `episode` | string |
| `dub` | string |
| `player` | string |
| `position` | number |
| `duration` | number |
| `playing` | boolean |
| `updatedAt` | number (client ms) |
| `sentAt` | number? (server добавляет при принятии room playback) |

Успех: `{"ok": true}`. В host-mode room playback меняет только host в
`follow`; в shared-mode — участник `follow` с `control: true`; начальное
состояние shared-комнаты может посеять host.

### `GET /watch-party/state?room=...`

Ответ:

```json
{
  "protocol": 2,
  "roomId": "A1B2C3",
  "roomMode": "host",
  "playback": null,
  "lastControllerId": null,
  "lastAction": null,
  "participants": [
    {
      "id": "uuid",
      "name": "Хост",
      "role": "host",
      "mode": "follow",
      "playback": null,
      "buffering": false,
      "online": true
    }
  ]
}
```

`online` означает heartbeat моложе 8 секунд. Guest без heartbeat дольше 5
минут удаляется при чтении state; host автоматически не удаляется.

### `POST /watch-party/transfer-host`

Body: `roomId`, host `token`, `participantId`. Успех:
`{"ok": true, "hostId": "uuid"}`.

### `POST /watch-party/leave`

Body: `roomId`, `token`. Всегда отвечает `{"ok": true}`. При выходе host роль
получает наиболее недавно активный участник; пустая комната удаляется.

### Ошибки Watch Party

| Code | HTTP | Условие |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | 404 | комнаты нет |
| `PARTICIPANT_NOT_FOUND` | 404 | token больше не принадлежит комнате |
| `NOT_HOST` | 403 | передачу роли запросил не host |

### `GET /health`

```json
{"ok": true, "watchPartyProtocol": 2}
```

### `WS /ws/watch-party/{room_id}`

Несуществующая комната закрывается кодом `4404`. После accept сервер сразу
отправляет state и далее broadcast после join/update/transfer/leave. Входящие
text frames не интерпретируются. Текущий React-клиент этот endpoint не открывает
и использует `POST update` + `GET state` раз в секунду; WS оставлен как
дополнительный push/compatibility contract.

## Google Drive API

| Метод и путь | Вход | Ответ / условие |
| --- | --- | --- |
| `GET /api/gdrive/status` | — | connected, oauth_pending, user_email/user_name, has_credentials/client_id, has_cloud_file/choice_pending, sync status |
| `GET /api/gdrive/network-check` | — | `{reachable:true,status_code}`; проверка без ключей, ошибка → 502 |
| `POST /api/gdrive/credentials` | client_id, optional client_secret | `{saved,checks[]}`; HTTP 200 не гарантирует saved=true |
| `GET /api/gdrive/auth-url` | optional redirect_uri | `{url,redirect_uri}`; без Client ID → 400 |
| `GET /api/gdrive/oauth2callback` | обязательные code/state | HTML, не JSON; Android может отложить обмен |
| `POST /api/gdrive/complete-auth` | без body | `{pending:false,connected,...}`; обмен pending code после foreground; transport error → 503, окончательная ошибка → 400 |
| `POST /api/gdrive/sync` | mode, prefer_watched, folder_mode, resolve_initial_choice | status uploaded/downloaded/merged, document, optional file_id/backup |
| `POST /api/gdrive/disconnect` | без body | `{disconnected:true,revoked:boolean}`; попытка revoke в Google и локальная очистка |

Sync status: `sync_state=idle|syncing|synced|error`, `sync_running`, `sync_pending`, `last_sync_at`, `last_sync_started_at`, `last_sync_error`. Секрет и OAuth tokens не выдаются.

Credentials сохраняются только при всех `checks[].status=valid`. Пустой/null secret сохраняет старый; смена resolved credentials отключает прежние tokens. OAuth использует authorization code и одноразовый in-memory state с TTL 10 минут, без PKCE. Scopes: drive.file, drive.appdata, userinfo.email; offline access и consent. Callback по умолчанию — origin backend + `/api/gdrive/oauth2callback`.

Desktop после успеха отправляет `GDRIVE_AUTH_SUCCESS` в opener со строгим target origin и закрывает popup; HTML ошибки тоже нужно различать через status. Android сохраняет pending code и выполняет `/complete-auth` после foreground; общий lock исключает двойной обмен.

```json
{"mode":"merge","prefer_watched":true,"folder_mode":"visible","resolve_initial_choice":false}
```

Defaults: mode auto, prefer_watched true, folder_mode visible, resolve_initial_choice false. Режимы: local заменяет cloud локальным документом; cloud заменяет local с backup; merge объединяет; anime_only сохраняет локальные theme/playerPrefs; auto выгружает при пустом cloud, объединяет обе стороны либо восстанавливает, если есть только cloud.

Ошибки: tokens отсутствуют → 401; первый выбор не завершён → 409; первый выбор в auto → 422; источник local отсутствует → 409; local повреждён → 500; cloud для восстановления отсутствует → 444. Первый выбор защищён и в autosave, и в explicit sync на сервере; `resolve_initial_choice:true` относится к явному выбору пользователя.

Disconnect пытается отозвать доступ у Google и очищает локальные tokens/pending; credentials и cloud-файл остаются. Подробные правила: [GDRIVE_SYNC.ru.md](GDRIVE_SYNC.ru.md).

## Static и SPA output

Если `settings.frontend_dist` существует, FastAPI:

1. монтирует `/assets` из `frontend/dist/assets`;
2. для `GET /{path:path}` отдаёт существующий файл из dist;
3. иначе отдаёт `frontend/dist/index.html` для клиентской навигации.

Catch-all подключается после API routers и не входит в OpenAPI.


## Офлайн-библиотека и загрузки

Потребители: `lib/downloads.ts`, `useDownloadManager`, `useOfflinePlayback`, `DownloadsPage` и Android network/foreground helpers. Backend: `api/downloads.py::offline_library`.

| Метод и путь | Вход | Ответ / эффект |
| --- | --- | --- |
| `GET /api/downloads/settings` | — | directory, allowMobileDownloads, флаги настроенных Kodik ключей |
| `PUT /api/downloads/settings` | directory, optional keys/clear flags/mobile preference | Обновлённые публичные настройки без ключей |
| `POST /api/downloads/credentials/validate` | optional public/private keys | `{canSave,checks[]}` |
| `GET /api/downloads/library` | — | `{directory,storage,anime,jobs}` |
| `GET /api/downloads/anime/{anime_id}` | ID | `{anime:OfflineAnime|null}` |
| `POST /api/downloads/scan` | без body | `{scanned,imported,existing,ignored}` |
| `POST /api/downloads/availability` | DownloadJobPayload | `{available,issues[]}` для точного качества |
| `GET /api/downloads/jobs` | — | `{jobs:DownloadJob[]}` |
| `POST /api/downloads/jobs` | DownloadJobPayload | Объект задачи без wrapper job |
| `DELETE /api/downloads/jobs/{job_id}` | ID | `{cancelled:true}` |
| `POST /api/downloads/network` | `{type}` | Нормализованный wifi/mobile/ethernet/vpn/none/unknown |
| `DELETE /api/downloads/episodes/{episode_id}` | ID | `{deleted:true}` |
| `POST /api/downloads/episodes/delete` | `{episodeIds:[...]}` | `{deleted:number}` |
| `DELETE /api/downloads/anime/{anime_id}` | ID | `{deleted:number}` |
| `GET /api/downloads/media/{episode_id}` | ID | MP4 или HLS playlist, inline |
| `GET /api/downloads/assets/{episode_id}/{asset_name}` | ID/asset | TS segment или binary |
| `GET /api/downloads/previews/{episode_id}` | ID | Файл предпросмотра |
| `GET /api/downloads/posters/{anime_id}` | ID | Файл постера |

Job: animeId, непустой title до 300, optional year/posterUrl, quality default 720 (144–2160), episodes 1–1000. Серия: videoId, season 1–99, episode 1–40 символов, dubbing 1–160, iframeUrl 8–4096; optional origin/translation/source IDs, названия, seasonLabel, duration, preview. Bulk delete: 1–1000 ID. Полные ограничения: [API_SCHEMA.ru.md](API_SCHEMA.ru.md).

OfflineAnime содержит animeId/title, optional year/poster/posterUrl, episodes, sizeBytes. OfflineEpisode хранит идентичность, сезон/серию/озвучку, качество/размер и локальные URL: [downloads.ts](../frontend/src/lib/downloads.ts). storage: totalBytes/usedBytes/freeBytes/libraryBytes. Job: id/animeId/title/quality/status/total/completed/progress/current/error/createdAt и optional pauseReason/queuePosition/items. Статусы: queued/downloading/paused/completed/cancelled/error. Причина мобильной паузы — mobile-network.

Отсутствующий job/file → 404 при обработке KeyError; ошибки библиотеки/валидации → 422. MIME: application/vnd.apple.mpegurl, video/mp4, video/mp2t либо application/octet-stream. Очередь в памяти, готовые файлы и индекс постоянны. Особенности MediaStore/Cast: [PLATFORMS.ru.md](PLATFORMS.ru.md).

## HTTP-заголовки и примеры

Middleware добавляет `Server-Timing: animesoul;dur=...`. Хешированные `/assets/` кешируются как public immutable на год; большинство ответов no-store; media/assets офлайн используют private immutable. CORS открывает Server-Timing и X-AnimeSoul-Yummy-Status / X-AnimeSoul-Kodik-Status.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
Invoke-RestMethod 'http://127.0.0.1:8000/api/yummy?mode=catalog&limit=12&offset=0'
Invoke-RestMethod 'http://127.0.0.1:8000/api/downloads/library'
Invoke-RestMethod 'http://127.0.0.1:8000/api/gdrive/status'
```

Примеры Kodik с доменами example описывают структуру: для вызова нужны реальные ID/URL выбранной серии. Возвращённый HTML SPA fallback не является JSON-ответом API.
