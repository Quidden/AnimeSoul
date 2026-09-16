[English](API_SCHEMA.md) | [Русский](API_SCHEMA.ru.md)

# Маршруты и модели запросов из исходников

Сгенерировано `tools/check_docs.py --write-api` без запуска приложения. Таблица включает все прикладные HTTP/WS-маршруты desktop. Watch Party и `/health` отключены на Android. Служебные `/docs`, `/redoc`, `/openapi.json`, статические файлы и SPA fallback не включены.

Аннотации ответов взяты из Python; `dict`/`Any` не описывают полную форму JSON. Динамические ответы, потребители, ошибки и примеры: [справочник API](API_REFERENCE.ru.md). Для живой схемы запустите backend и откройте `/openapi.json`.

**46 маршрутов**

| Метод | Путь | Python-обработчик | Аннотация ответа |
| --- | --- | --- | --- |
| GET | `/api/community-ratings` | [list_community_ratings](../backend/app/api/community_ratings.py#L24) | `dict[str, Any]` |
| GET | `/api/community-ratings/{anime_id}` | [get_community_rating](../backend/app/api/community_ratings.py#L46) | `dict[str, Any]` |
| PUT | `/api/community-ratings/{anime_id}` | [publish_community_rating](../backend/app/api/community_ratings.py#L55) | `dict[str, Any]` |
| DELETE | `/api/downloads/anime/{anime_id}` | [delete_downloaded_anime](../backend/app/api/downloads.py#L184) | `dict[str, int]` |
| GET | `/api/downloads/anime/{anime_id}` | [get_downloaded_anime](../backend/app/api/downloads.py#L122) | `dict[str, Any]` |
| GET | `/api/downloads/assets/{episode_id}/{asset_name}` | [downloaded_media_asset](../backend/app/api/downloads.py#L209) | `FileResponse` |
| POST | `/api/downloads/availability` | [check_download_availability](../backend/app/api/downloads.py#L132) | `dict[str, Any]` |
| POST | `/api/downloads/credentials/validate` | [validate_kodik_credentials](../backend/app/api/downloads.py#L114) | `dict[str, Any]` |
| POST | `/api/downloads/episodes/delete` | [delete_downloaded_episodes](../backend/app/api/downloads.py#L175) | `dict[str, int]` |
| DELETE | `/api/downloads/episodes/{episode_id}` | [delete_downloaded_episode](../backend/app/api/downloads.py#L166) | `dict[str, bool]` |
| GET | `/api/downloads/jobs` | [get_download_jobs](../backend/app/api/downloads.py#L127) | `dict[str, list[dict[str, Any]]]` |
| POST | `/api/downloads/jobs` | [create_download_job](../backend/app/api/downloads.py#L148) | `dict[str, Any]` |
| DELETE | `/api/downloads/jobs/{job_id}` | [cancel_download_job](../backend/app/api/downloads.py#L157) | `dict[str, bool]` |
| GET | `/api/downloads/library` | [get_offline_library](../backend/app/api/downloads.py#L101) | `dict[str, Any]` |
| GET | `/api/downloads/media/{episode_id}` | [downloaded_media](../backend/app/api/downloads.py#L193) | `FileResponse` |
| POST | `/api/downloads/network` | [update_download_network](../backend/app/api/downloads.py#L143) | `dict[str, str]` |
| GET | `/api/downloads/posters/{anime_id}` | [downloaded_poster](../backend/app/api/downloads.py#L229) | `FileResponse` |
| GET | `/api/downloads/previews/{episode_id}` | [downloaded_preview](../backend/app/api/downloads.py#L220) | `FileResponse` |
| POST | `/api/downloads/scan` | [scan_offline_library](../backend/app/api/downloads.py#L106) | `dict[str, int]` |
| GET | `/api/downloads/settings` | [get_offline_settings](../backend/app/api/downloads.py#L81) | `dict[str, str \| bool]` |
| PUT | `/api/downloads/settings` | [set_offline_settings](../backend/app/api/downloads.py#L86) | `dict[str, str \| bool]` |
| GET | `/api/episode-dates/{mal_id}` | [get_episode_dates](../backend/app/api/episode_dates.py#L14) | `dict` |
| GET | `/api/gdrive/auth-url` | [get_auth_url](../backend/app/api/gdrive.py#L201) | `dict[str, str]` |
| POST | `/api/gdrive/complete-auth` | [complete_auth](../backend/app/api/gdrive.py#L289) | `dict[str, Any]` |
| POST | `/api/gdrive/credentials` | [set_credentials](../backend/app/api/gdrive.py#L188) | `dict[str, Any]` |
| POST | `/api/gdrive/disconnect` | [disconnect](../backend/app/api/gdrive.py#L318) | `dict[str, bool]` |
| GET | `/api/gdrive/network-check` | [network_check](../backend/app/api/gdrive.py#L174) | `dict[str, Any]` |
| GET | `/api/gdrive/oauth2callback` | [oauth2callback](../backend/app/api/gdrive.py#L219) | `str` |
| GET | `/api/gdrive/status` | [get_status](../backend/app/api/gdrive.py#L151) | `dict[str, Any]` |
| POST | `/api/gdrive/sync` | [sync_drive](../backend/app/api/gdrive.py#L417) | `dict[str, Any]` |
| GET | `/api/health` | [health](../backend/app/main.py#L93) | `dict[str, object]` |
| GET | `/api/kodik` | [kodik_proxy](../backend/app/api/kodik.py#L38) | `dict[str, object]` |
| POST | `/api/kodik/stream` | [kodik_stream](../backend/app/api/kodik.py#L55) | `dict[str, object]` |
| GET | `/api/storage` | [read_storage](../backend/app/api/storage.py#L22) | `dict[str, Any]` |
| PUT | `/api/storage` | [write_storage](../backend/app/api/storage.py#L30) | `dict[str, object]` |
| GET | `/api/yummy` | [yummy_proxy](../backend/app/api/yummy.py#L110) | `dict` |
| GET | `/api/yummy/credentials` | [yummy_credentials](../backend/app/api/yummy.py#L45) | `dict[str, bool]` |
| POST | `/api/yummy/credentials` | [save_yummy_credentials](../backend/app/api/yummy.py#L52) | `dict[str, object]` |
| GET | `/health` | [watch_party_health](../backend/app/api/watch_party.py#L79) | `dict[str, Any]` |
| POST | `/watch-party/create` | [create_room](../backend/app/api/watch_party.py#L33) | `dict[str, Any]` |
| POST | `/watch-party/join` | [join_room](../backend/app/api/watch_party.py#L41) | `Any` |
| POST | `/watch-party/leave` | [leave_room](../backend/app/api/watch_party.py#L73) | `dict[str, bool]` |
| GET | `/watch-party/state` | [room_state](../backend/app/api/watch_party.py#L67) | `Any` |
| POST | `/watch-party/transfer-host` | [transfer_host](../backend/app/api/watch_party.py#L57) | `Any` |
| POST | `/watch-party/update` | [update_room](../backend/app/api/watch_party.py#L51) | `Any` |
| WS | `/ws/watch-party/{room_id}` | [watch_party_socket](../backend/app/api/watch_party.py#L84) | `None` |

## Модели тела запроса

`Field(...)`: ограничения Pydantic; отсутствие default означает обязательное поле.

### OfflineSettingsPayload

[OfflineSettingsPayload](../backend/app/api/downloads.py#L23)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `directory` | `str` | `Field(min_length=1, max_length=2048)` |
| `kodikPublicKey` | `str \| None` | `Field(default=None, max_length=512)` |
| `kodikPrivateKey` | `str \| None` | `Field(default=None, max_length=512)` |
| `clearKodikPublicKey` | `bool` | `False` |
| `clearKodikPrivateKey` | `bool` | `False` |
| `allowMobileDownloads` | `bool \| None` | `None` |

### DownloadNetworkPayload

[DownloadNetworkPayload](../backend/app/api/downloads.py#L32)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `type` | `str` | `Field(min_length=1, max_length=24)` |

### KodikCredentialsPayload

[KodikCredentialsPayload](../backend/app/api/downloads.py#L36)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `kodikPublicKey` | `str \| None` | `Field(default=None, max_length=512)` |
| `kodikPrivateKey` | `str \| None` | `Field(default=None, max_length=512)` |

### DownloadEpisodePayload

[DownloadEpisodePayload](../backend/app/api/downloads.py#L41)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `videoId` | `int \| str` | `обязательное` |
| `season` | `int` | `Field(ge=1, le=99)` |
| `seasonLabel` | `str \| None` | `Field(default=None, max_length=300)` |
| `episode` | `str` | `Field(min_length=1, max_length=40)` |
| `originAnimeId` | `int \| None` | `None` |
| `originEpisode` | `str \| None` | `None` |
| `dubbing` | `str` | `Field(min_length=1, max_length=160)` |
| `translationId` | `int \| str \| None` | `None` |
| `iframeUrl` | `str` | `Field(min_length=8, max_length=4096)` |
| `sourceId` | `str \| None` | `Field(default=None, max_length=80)` |
| `sourceIdType` | `str \| None` | `Field(default=None, max_length=40)` |
| `sourceTitle` | `str \| None` | `Field(default=None, max_length=300)` |
| `sourceOriginalTitle` | `str \| None` | `Field(default=None, max_length=300)` |
| `duration` | `int \| float \| None` | `None` |
| `previewUrl` | `str \| None` | `Field(default=None, max_length=4096)` |

### DownloadJobPayload

[DownloadJobPayload](../backend/app/api/downloads.py#L59)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `animeId` | `int` | `обязательное` |
| `title` | `str` | `Field(min_length=1, max_length=300)` |
| `year` | `int \| None` | `None` |
| `posterUrl` | `str \| None` | `Field(default=None, max_length=4096)` |
| `quality` | `int` | `Field(default=720, ge=144, le=2160)` |
| `episodes` | `list[DownloadEpisodePayload]` | `Field(min_items=1, max_items=1000)` |

### DeleteEpisodesPayload

[DeleteEpisodesPayload](../backend/app/api/downloads.py#L70)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `episodeIds` | `list[str]` | `Field(min_items=1, max_items=1000)` |

### CredentialsRequest

[CredentialsRequest](../backend/app/api/gdrive.py#L28)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `client_id` | `str` | `обязательное` |
| `client_secret` | `str \| None` | `None` |

### SyncRequest

[SyncRequest](../backend/app/api/gdrive.py#L143)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `mode` | `Literal['auto', 'local', 'cloud', 'merge', 'anime_only']` | `'auto'` |
| `prefer_watched` | `bool` | `True` |
| `folder_mode` | `Literal['visible', 'appdata']` | `'visible'` |
| `resolve_initial_choice` | `bool` | `False` |

### KodikStreamPayload

[KodikStreamPayload](../backend/app/api/kodik.py#L22)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `videoId` | `int \| str` | `обязательное` |
| `season` | `int` | `Field(ge=1, le=99)` |
| `episode` | `str` | `Field(min_length=1, max_length=40)` |
| `originAnimeId` | `int \| None` | `None` |
| `originEpisode` | `str \| None` | `Field(default=None, max_length=40)` |
| `dubbing` | `str` | `Field(min_length=1, max_length=160)` |
| `translationId` | `int \| str \| None` | `None` |
| `iframeUrl` | `str` | `Field(min_length=8, max_length=4096)` |
| `sourceId` | `str \| None` | `Field(default=None, max_length=80)` |
| `sourceIdType` | `str \| None` | `Field(default=None, max_length=40)` |
| `sourceTitle` | `str \| None` | `Field(default=None, max_length=300)` |
| `sourceOriginalTitle` | `str \| None` | `Field(default=None, max_length=300)` |

### YummyCredentialsRequest

[YummyCredentialsRequest](../backend/app/api/yummy.py#L40)

| Поле | Тип | Default / ограничения |
| --- | --- | --- |
| `token` | `str` | `Field(min_length=1, max_length=512)` |
