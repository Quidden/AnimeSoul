# API AnimeSoul и используемые внешние поля

Справочник описывает фактические контракты версии 0.2.3. Все внутренние URL
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

## Сводка маршрутов

| Метод | Путь | Назначение | Backend | Основной frontend-потребитель |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | готовность и идентификация runtime | `backend/app/main.py` | `run.py`, `launcher.py` |
| `GET` | `/api/storage` | чтение полного сохранения | `api/storage.py` | `useProfileStorage` |
| `PUT` | `/api/storage` | атомарная запись и optional autosync | `api/storage.py` | `saveStorageDocument` |
| `GET` | `/api/yummy` | proxy catalog/details/videos/trailers/schedule/ping | `api/yummy.py` | catalog/tracking/player/header |
| `GET` | `/api/kodik` | проверка доступности Kodik | `api/kodik.py` | settings/diagnostics |
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
  "version": "0.2.3",
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

Query:

| Поле | Тип | Default | Смысл |
| --- | --- | --- | --- |
| `auto_sync` | boolean | `true` | после локальной записи поставить Drive autosave в общую очередь, если tokens существуют |

Body — полный JSON-документ. Backend проверяет только, что `profiles` является
массивом; версию и внутренние поля мигрирует frontend.

Успех:

```json
{
  "saved": true,
  "path": "C:\\...\\data\\animesoul-storage.json"
}
```

`path` — локальный диагностический путь. Этот маршрут предназначен для
loopback-приложения; при публичном размещении абсолютный путь следует убрать из
ответа. Невалидная оболочка даёт `422` с `Invalid storage document`.

Frontend выставляет `auto_sync=true` только если локальный режим равен
`instant` и завершён первоначальный cloud choice. Значения `interval` и
`manual` выключают autosync конкретного PUT. Для режима `interval` отдельный
таймер находится в `components/Header.tsx`: пока header смонтирован и Drive
подключён, он вызывает `syncGDrive("merge", ...)` с выбранным интервалом.

## YummyAnime proxy

### `GET /api/yummy`

Общие query-поля:

| Поле | Тип | Default/ограничение | Использование |
| --- | --- | --- | --- |
| `mode` | string | `catalog` | ветка proxy |
| `id` | integer/null | `null` | один anime ID для `videos`, `trailers` |
| `ids` | comma-separated string | `""`, не более 50 элементов | пакет `details` |
| `limit` | integer | `24`, 1–48 | catalog/search |
| `offset` | integer | `0`, не меньше 0 | catalog/search |
| `q` | string | `""` | поисковая строка |

Неизвестный `mode` попадает в поведение `catalog`.

#### `mode=catalog`

Upstream без `q`: `GET https://api.yani.tv/anime?limit=&offset=`.

Upstream с `q`: `YummyAnimeGateway.search` строит до четырёх вариантов
(исходный запрос, исправленная раскладка, транслитерация, известные псевдонимы),
выполняет их параллельно и возвращает первую непустую страницу. Backend cache —
5 минут/до 128 записей с объединением одинаковых in-flight запросов; frontend
cache первой страницы поиска — 5 минут/до 40 записей.

Ответ:

```json
{"anime": [], "hasMore": false}
```

`hasMore` вычисляется как `anime.length === limit`, а не из upstream total.

#### `mode=details`

Для каждого непустого элемента `ids`, максимум 50, выполняется параллельный
`GET /anime/{id}`. Ошибка отдельного элемента исключает только его из результата.

```json
{"anime": []}
```

#### `mode=videos`

Требует `id`, иначе `400`. Параллельно выполняет `GET /anime/{id}` и
`GET /anime/{id}/videos`.

```json
{"anime": {}, "videos": []}
```

Текущий typed frontend helper `fetchAnimeVideos` использует `videos`, а
`anime` в составном ответе доступен другим/старым потребителям.

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

- нет Public token: `503` с текстом `YummyAnime token is not configured`;
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

### `GET /api/gdrive/status`

Ответные поля:

| Поле | Тип | Источник |
| --- | --- | --- |
| `connected` | boolean | есть tokens с `access_token` |
| `user_email` | string | Google userinfo |
| `user_name` | string | Google userinfo |
| `has_credentials` | boolean | найден Client ID |
| `client_id` | string | активный Client ID; secret не возвращается |
| `has_cloud_file` | boolean | cached cloud existence |
| `choice_pending` | boolean | нужен первоначальный выбор |
| `sync_state` | `idle|syncing|synced|error` | runtime sync state |
| `sync_running` | boolean | активна background task |
| `sync_pending` | boolean | в очереди есть более новый документ |
| `last_sync_at` | Unix seconds | последний подтверждённый успех |
| `last_sync_started_at` | Unix seconds | последний запуск в текущем процессе |
| `last_sync_error` | string | последняя ошибка |

### `POST /api/gdrive/credentials`

Body:

```json
{"client_id": "...", "client_secret": null}
```

`client_id` обязателен Pydantic-модели, `client_secret` optional. Пустой/`null`
secret сохраняет ранее записанный secret. Смена уже существующих credentials
удаляет OAuth tokens. Ответ: `{"saved": true}`.

### `GET /api/gdrive/auth-url`

Optional query `redirect_uri`. Без него backend строит
`{request.base_url}/api/gdrive/oauth2callback`. Ответ:

```json
{"url": "https://accounts.google.com/o/oauth2/v2/auth?...", "redirect_uri": "..."}
```

Запрашиваются scopes `drive.file`, `drive.appdata`, `userinfo.email`, offline
access и consent. `state` живёт в памяти процесса 10 минут и потребляется один
раз. Без Client ID возвращается `400`.

### `GET /api/gdrive/oauth2callback?code=...&state=...`

Оба query обязательны. Backend проверяет state, меняет code на tokens, получает
userinfo, проверяет наличие cloud-файла и сохраняет tokens. Ответ — HTML, а не
JSON. При успехе popup отправляет opener:

```js
{ type: "GDRIVE_AUTH_SUCCESS" }
```

со строгим target origin текущего backend и пытается закрыться через 1.5 с.
Ошибки OAuth также возвращаются HTML-страницей; HTTP status остаётся обычным
ответом route, поэтому frontend узнаёт итог повторным status polling.

### `POST /api/gdrive/sync`

Body:

| Поле | Тип | Default |
| --- | --- | --- |
| `mode` | `auto|local|cloud|merge|anime_only` | `auto` |
| `prefer_watched` | boolean | `true` |
| `folder_mode` | `visible|appdata` | `visible` |

Результат:

```json
{
  "status": "uploaded|downloaded|merged",
  "file_id": "optional-google-file-id",
  "document": {}
}
```

- `local`: upload локального документа;
- `cloud`: полная локальная замена cloud-документом; без файла — `444`;
- `merge`: детерминированный merge обоих и upload результата;
- `anime_only`: merge, сохраняющий локальные `theme` и `playerPrefs`;
- `auto`: upload, если cloud пуст, иначе merge при наличии обеих сторон.

Без tokens: `401`. Route обновляет `sync_state/last_sync_*` до/после операции.
Точные merge-правила находятся в [`GDRIVE_SYNC.md`](GDRIVE_SYNC.md).

### `POST /api/gdrive/disconnect`

Удаляет только локальный `gdrive-tokens.json`; credentials остаются. Ответ:
`{"disconnected": true}`.

## Static и SPA output

Если `settings.frontend_dist` существует, FastAPI:

1. монтирует `/assets` из `frontend/dist/assets`;
2. для `GET /{path:path}` отдаёт существующий файл из dist;
3. иначе отдаёт `frontend/dist/index.html` для клиентской навигации.

Catch-all подключается после API routers и не входит в OpenAPI.
