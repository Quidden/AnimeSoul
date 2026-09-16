[English](BACKEND.md) | [Русский](BACKEND.ru.md)

# Бэкенд: сервисы и жизненный цикл

Пути ниже начинаются от `app/backend/app/`. [Архитектура](../ARCHITECTURE.ru.md) · [API](API_REFERENCE.ru.md) · [Маршруты и модели](API_SCHEMA.ru.md)

## Жизненный цикл приложения

1. `config.load_settings` вычисляет пути и ключи из JSON/environment; `.env` заполняет только отсутствующие переменные.
2. Импорты router создают сервисы для data directory. `get_gdrive_service` объединяет состояние/очередь Drive. `JsonStorage` разделяет lock для одного физического пути между объектами сервисов.
3. `main.app` подключает восемь router-модулей на desktop; `ANIMESOUL_MOBILE=android` исключает Watch Party.
4. Middleware добавляет `Server-Timing`. Хешированные `/assets/` кешируются на год как immutable; большинство ответов получает `no-store`; офлайн media/assets задают private immutable.
5. Существующая dist-сборка раздаётся через `/assets` и catch-all после API. Отсутствующий frontend нужно собрать до запуска процесса.
6. Lifespan закрывает Yummy, Kodik и клиент дат через `asyncio.gather(..., return_exceptions=True)`.

## Карта сервисов

| Сервис / файл | Основные операции | Граница |
| --- | --- | --- |
| `HybridCatalogueService` / `catalog.py` | `catalogue`, `details`, `videos` | Координация Yummy/Kodik, заполнение пропусков, статус источников |
| `AnimeIdentityRegistry` / `catalog.py` | `remember`, `get` | Сохранение соответствий идентичности для fallback |
| `YummyAnimeGateway` / `yummy.py` | `request`, `search`, `clear_cache`, `close` | Заголовки токена, варианты поиска, HTTP pool, dedup/cache |
| `KodikAnimeGateway` / `kodik.py` | Каталог/lookup/ping | Нормализация метаданных и воспроизводимых серий |
| `anime_identity.py`, `episode_links.py`, `kodik_helpers.py` | Сопоставление и нормализация | Отделение идентичности тайтла от экранной нумерации франшизы |
| `PersistentJsonCache` / `response_cache.py` | Fresh/stale JSON cache | SQLite + память; fingerprint ключа в cache key |
| `EpisodeDatesGateway` / `episode_dates.py` | Получение/кеш дат | Календарные даты Jikan независимо от видео |
| `OfflineLibraryService` / `offline_library.py` | `settings`, `library`, `enqueue`, `cancel`, `playback_source`, удаление/scan | Настройки устройства, последовательная очередь, индекс и файлы |
| `KodikSourceResolver` / `kodik_resolver.py` | `resolve_playback_api` | Точный URL серии и подпись private video-links |
| `JsonStorage` / `storage.py` | `read`, `write`, `backup`, `replace_with_backup` | Проверка, сериализация, атомарный JSON, импорт legacy |
| `GoogleDriveService` / `gdrive.py` | OAuth, cloud I/O, `schedule_write`, статус | Общая очередь и pending auth |
| `gdrive_merge.py` | `merge_storage_documents`, слияние профиля/серии | Чистая детерминированная политика конфликтов |
| `CommunityRatingStore` / `community_ratings.py` | `replace`, `aggregate`, `list_anime_ids` | Анонимные деревья оценок SQLite |
| `WatchPartyService` / `watch_party.py` | Create/join/update/state/leave/transfer | Участники и playback в памяти, optional WS broadcast |

## Каталог и сбои источников

`api/yummy.py` сохраняет endpoint UI, вызывая гибридный сервис. Kodik дополняет Yummy; `_sources` и заголовки описывают результат. Строгое сопоставление ID/названия/года/типа предотвращает смешивание разных частей. `episode_identity_version=1` позволяет исправлять старую базу tracking только при успешных ответах источников.

Поиск пробует до четырёх вариантов параллельно. Постоянный кеш использует fresh TTL и stale при ошибке; одинаковые текущие запросы объединяются. Ответ из кеша не является новым сохранением профиля. Подписанные stream URL получают для просмотра и не включают в переносимые данные каталога.

## Жизненный цикл загрузки

`check_download_availability` проверяет точное качество до создания задачи. `enqueue` проверяет ключи и выбор, регистрирует job и запускает последовательную обработку. Состояния: `queued → downloading → completed`, ответвления `paused`, `cancelled`, `error`. Позиция очереди и счётчики существуют в runtime. Новую задачу можно добавить во время предыдущей.

Desktop использует локальные файлы и FFmpeg. Android использует FFmpegKit/native helpers и публикует seekable MP4 через MediaStore. Индекс, постеры и настройки приватны. Монитор сети приостанавливает запрещённые мобильные загрузки; foreground service следит за задачами и держит scoped wake lock во время работы. Очередь не переживает завершение процесса/перезагрузку. Готовые файлы можно пересканировать.

Media endpoints находят файл по ID библиотеки, а не принимают произвольный путь. HLS playlist/segments и MP4 имеют разные MIME-типы. [Контракты загрузок](API_REFERENCE.ru.md).

## Конкурентная запись и облако

`validate_storage_document` требует object, непустой массив profiles, непустые строковые ID и object snapshots; заданный activeProfile обязан существовать. `JsonStorage` сохраняет непрозрачные domain fields и использует общий lock плюс temp/replace. `replace_with_backup` сохраняет предыдущий файл перед восстановлением из облака.

Локальный `PUT` завершается раньше Drive. `choice_pending` блокирует автоматическое облачное сохранение на сервере. Первый явный sync требует `resolve_initial_choice=true` и режим кроме auto. Worker объединяет pending, перечитывает latest local и не заменяет более новое сохранение после сетевого ожидания. [Правила merge](GDRIVE_SYNC.ru.md).

## Границы runtime и доверия

Обычный backend слушает loopback без общего login/authorization middleware. CORS разрешает localhost/127.0.0.1:5173 и не является сетевой авторизацией. Ключи остаются в backend/device storage. Source headers и `Server-Timing` служат диагностике. Общие оценки относятся к текущему серверу. Party token разрешает действия участника, но state читается по room ID: это не защищённый публичный сервис комнат.

## Проверка

Из `app/` запускайте `python -m unittest discover -s backend/tests -v`. Отдельные модули покрывают storage safety, sync/merge, runtime/startup, fallback каталога, идентичность/даты/ссылки серий, офлайн, оценки, кеш и поиск. После изменения маршрута выполните `python tools/check_docs.py --write-api`, затем обновите оба языковых контракта. Реальное медиа и устройство проверяются дополнительно.
