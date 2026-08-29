# Карта проекта AnimeSoul

Документ отвечает на два вопроса: где находится нужная логика и за что отвечает
каждый важный файл. Пути указаны от корня репозитория.

## Корень репозитория

| Путь | Назначение |
| --- | --- |
| `Start AnimeSoul.bat` | передаёт аргументы в актуальный `app/Start AnimeSoul.bat` |
| `README.md` | граница между актуальным и архивным стеками, общий старт |
| `app/` | поддерживаемая реализация |
| `legacy-old-stack/` | архив Vinext/Electron и источник совместимого сохранения |
| `build/`, `dist/`, `release-work/` | результаты локальной упаковки; не являются исходниками приложения |

## Запуск, конфигурация и упаковка `app/`

| Путь | Назначение / публичная поверхность |
| --- | --- |
| `app/run.py` | CLI runtime: конфигурация, порт, Uvicorn, браузер/PyWebView, desktop zoom; точка `main()` |
| `app/launcher.py` | WebView-лаунчер установленной сборки; JS bridge `LauncherApi`, безопасная остановка только собственного runtime |
| `app/runtime_instance.py` | атомарный `animesoul.runtime.json`, поиск свободного порта и проверка instance ID |
| `app/animesoul.python.example.json` | пример машинной конфигурации без рабочих токенов |
| `app/Start AnimeSoul.bat` | venv, changed-only prepare, затем `run.py` |
| `app/Start AnimeSoul in Browser.bat` | добавляет `--mode browser` |
| `app/Start AnimeSoul Desktop.bat` | добавляет `--mode desktop` |
| `app/Configure AnimeSoul.bat` | добавляет `--configure` |
| `app/packaging/build_windows.ps1` | сборка launcher/runtime и Windows-установщика |
| `app/packaging/launcher.spec` | PyInstaller-описание лаунчера |
| `app/packaging/runtime.spec` | PyInstaller-описание runtime |
| `app/packaging/AnimeSoul.iss` | Inno Setup-сценарий |
| `app/packaging/assets/` | общая иконка installer, launcher и runtime |

## Backend

### Application и конфигурация

| Путь | Назначение |
| --- | --- |
| `app/backend/app/main.py` | объект `FastAPI`, CORS, routers, `/api/health`, static assets и SPA fallback |
| `app/backend/app/config.py` | `Settings`, чтение `.env`, JSON-конфига и environment overrides; вычисление data/dist/legacy paths |
| `app/backend/app/api/__init__.py` | граница пакета HTTP-адаптеров |
| `app/backend/app/services/__init__.py` | граница пакета сервисов |
| `app/backend/requirements.txt` | runtime/test зависимости Python |

### HTTP и WebSocket adapters

| Путь | Маршруты | Что делает |
| --- | --- | --- |
| `api/yummy.py` | `GET /api/yummy` | выбирает proxy mode, валидирует query, собирает составные ответы |
| `api/storage.py` | `GET/PUT /api/storage` | проверяет оболочку, читает/пишет JSON, планирует autosync |
| `api/watch_party.py` | `/watch-party/*`, `/ws/watch-party/*`, `/health` | переводит JSON в команды комнаты и стабильные ошибки |
| `api/gdrive.py` | `/api/gdrive/*` | OAuth callback, credentials, status и явная sync-координация |
| `api/community_ratings.py` | `/api/community-ratings*` | валидация оценок, anonymous cookie и публичные агрегаты |

### Services и чистые правила

| Путь | Назначение / ключевые функции |
| --- | --- |
| `services/yummy.py` | `YummyAnimeGateway`, варианты поискового запроса, cache/in-flight dedup, URL normalization |
| `services/http_client.py` | lazy lifecycle общего `httpx.AsyncClient` для upstream gateway |
| `services/response_cache.py` | SQLite + memory cache публичных upstream-ответов, TTL и stale-if-error |
| `services/storage.py` | `JsonStorage.read/write`, temp-файл и atomic replace, первый импорт legacy |
| `services/watch_party.py` | `WatchPartyService`, `Room`, `Participant`, REST-authoritative state и WS broadcast |
| `services/gdrive.py` | `GoogleDriveService`: credentials/tokens, OAuth, Drive folder/file I/O, coalesced autosave |
| `services/gdrive_merge.py` | `merge_storage_documents`, `merge_profile`, `merge_snapshot`, episode conflict policy |
| `services/community_ratings.py` | `CommunityRatingStore`, SQLite WAL, replace/delete vote и aggregate |

### Backend tests

| Путь | Проверяет |
| --- | --- |
| `backend/tests/test_services.py` | storage и Watch Party lifecycle |
| `backend/tests/test_yummy_search.py` | раскладка, транслитерация, псевдонимы, cache/in-flight search |
| `backend/tests/test_gdrive.py` | merge, autosave и конфликтные правила |
| `backend/tests/test_community_ratings.py` | SQLite aggregate, валидация и HTTP-контракт |
| `backend/tests/test_run_startup.py` | выбор занятого/свободного порта и startup branches |
| `backend/tests/test_runtime_instance.py` | runtime state, instance ownership и атомарность |

## Frontend bootstrap

| Путь | Назначение |
| --- | --- |
| `app/frontend/index.html` | HTML shell, `#root`, favicon и preconnect к trailer-хостам |
| `app/frontend/vite.config.ts` | React plugin, dev port, proxy `/api`, `/watch-party`, `/ws`, output `dist` |
| `app/frontend/src/main.tsx` | debug capture, глобальный CSS, `createRoot(<App />)` |
| `app/frontend/src/App.tsx` | состояние навигации и композиция feature controllers/pages/modals |
| `app/frontend/src/version.ts` | отображаемая версия приложения |

## Frontend pages

| Путь | Экран / ответственность |
| --- | --- |
| `pages/HomePage.tsx` | композиция главной страницы из hero, widgets и library sections |
| `pages/CatalogPage.tsx` | фильтры, сортировка, карточки, пагинация и случайный выбор |
| `pages/RatingsPage.tsx` | сохранённые личные/общие оценки и быстрое редактирование |
| `pages/StatisticsPage.tsx` | итоговые метрики, календарь, месяцы, дни недели и жанры |
| `pages/FolderView.tsx` | содержимое одной пользовательской папки, заметки и сортировка |
| `pages/home/types.ts` | `HomePageModel` и `HomePageActions` — контракт главной страницы |
| `pages/home/HomeHero.tsx` | cinematic hero, продолжение и активная Watch Party |
| `pages/home/DashboardWidgets.tsx` | панели отслеживания, папок и кратких показателей |
| `pages/home/LibrarySections.tsx` | избранное, «смотрю», история и раскрытие секций |

## Frontend features

### Catalog

| Путь | Назначение |
| --- | --- |
| `features/catalog/api.ts` | typed transport для catalog/details/videos/trailers/schedule, frontend search cache |
| `features/catalog/useCatalogController.ts` | view, query, filters, pagination, загрузка сохранённых ID и video statistics |
| `features/catalog/useCatalogPresentation.ts` | franchise grouping, card metadata, genres, visible collections |

### Library, player и tracking

| Путь | Назначение |
| --- | --- |
| `features/library/selectors.ts` | чистые history/watching/folder/statistics selectors |
| `features/library/useFolderManagement.ts` | состояние folder picker/view, создание, удаление/отмена, заметки и сортировка пользовательских папок |
| `features/navigation/useAppNavigation.ts` | стабильные переходы между экранами, открытие тайтла и обработка native back |
| `features/player/types.ts` | props/контракты экрана просмотра |
| `features/player/useResumePreview.ts` | выбор последнего доступного продолжения и его preview |
| `features/player/activeWatchActions.ts` | запись прогресса и подтверждение новой серии |
| `features/player/PlayerToolbar.tsx` | настройки источника, озвучки и действий плеера |
| `features/player/SeasonList.tsx` | сезоны, серии, прогресс и ручные отметки |
| `features/player/ReleaseSchedule.tsx` | сведения о следующем/предыдущем выпуске |
| `features/player/WatchInfo.tsx` | метаданные и информация о выбранном тайтле |
| `features/player/WatchPartyPanel.tsx` | UI комнаты и участников |
| `features/tracking/api.ts` | детали франшизы и последовательная загрузка videos для tracking snapshot |

### Storage и settings

| Путь | Назначение |
| --- | --- |
| `features/storage/profileDocument.ts` | чистая сборка/разрешение `StorageDocument` и сохранение неизвестных полей |
| `features/storage/useProfileStorage.ts` | startup hydrate, localStorage mirror, debounce-save, import/export/switch profile |
| `features/settings/settingsCatalog.ts` | вкладки и поисковые термины настроек |
| `features/settings/Setting.tsx` | единая строка настройки и фильтрация по поиску |
| `features/settings/AppearanceSettings.tsx` | темы, цвета и CSS-масштабы |
| `features/settings/PlaybackSettings.tsx` | продолжение, плеер, панель управления и история |
| `features/settings/WatchPartySettings.tsx` | параметры комнат и инструкция совместного просмотра |
| `features/settings/ProfileSettings.tsx` | профили, import/export и переключение |
| `features/settings/useGoogleDriveSettings.ts` | статус OAuth/sync, команды подключения и presentation state |
| `features/settings/CloudSettings.tsx` | UI Google Drive |
| `features/settings/GoogleOAuthSetup.tsx` | ввод Client ID/Secret и инструкция OAuth |
| `features/settings/GoogleDriveInitialSyncModal.tsx` | обязательный первоначальный выбор при существующем cloud-файле |

### Ratings и Watch Party

| Путь | Назначение |
| --- | --- |
| `features/ratings/api.ts` | пакетное чтение агрегатов и PUT полного дерева личной оценки |
| `features/ratings/useCommunityRatings.ts` | retry, очередь удалений и публикация при изменении `updatedAt` |
| `features/watch-party/api.ts` | sessionStorage, REST transport, protocol guard и ошибки |
| `features/watch-party/types.ts` | локальная сессия `{roomId, token, role}` |
| `features/watch-party/usePartyHostPlayback.ts` | разрешение playback ведущего комнаты в полную запись каталога |

## Shared components

| Путь | Назначение |
| --- | --- |
| `components/Header.tsx` | бренд, навигация, поиск, профили и статусы API/save/cloud/party |
| `features/header/useHeaderCloudSync.ts` | polling, lifecycle merge, interval sync и presentation Google Drive в header |
| `components/Player.tsx` | выбор direct/iframe-плеера, сезоны, sources, progress, Kodik messages и Watch Party |
| `features/player/AnimeSoulPlayer.tsx` | собственные HLS controls, качество, субтитры, continuity и skip-маркеры |
| `components/SettingsCenter.tsx` | modal shell, вкладки, поиск и orchestration настроек |
| `components/AnimeCard.tsx` | карточка каталога и progress bar |
| `components/RatingBoard.tsx` | сводка источников рейтинга |
| `components/ScorePicker.tsx` | выбор личной оценки 1–10 |
| `components/CollectionOverview.tsx` | подробности избранного, папок и tracking |
| `components/FolderPicker.tsx` | добавление/удаление тайтла из папок |
| `components/EpisodeSlideshow.tsx` | кадры серии или fallback poster |
| `components/EpisodeHoverPreview.tsx` | позиционируемое preview серии |
| `components/Toggle.tsx` | общий доступный переключатель |
| `components/ReleaseMark.tsx` | статус релиза/следующей серии |
| `components/FAQBlock.tsx` | справка на главной |
| `components/DebugPanel.tsx` | журнал отладки и экспорт |
| `components/ChangelogModal.tsx` | встроенная история версий |
| `components/AppFooter.tsx` | общий footer продукта |

## Hooks и `lib/`

| Путь | Назначение |
| --- | --- |
| `hooks/useApiActivity.ts` | сетевой статус и latency для header |
| `hooks/usePublishedSaveStatus.ts` | публикация статуса файла в typed event |
| `hooks/useEpisodeTracking.ts` | запуск сразу и каждые 5 минут, защита от частичного сбоя |
| `hooks/useWatchParty.ts` | create/join/update/state/leave, REST polling и feedback-loop guard |
| `lib/types.ts` | все общие API, storage, player, rating и party типы |
| `lib/http.ts` | общий JSON transport, извлечение backend error и typed HTTP status/code |
| `lib/settings.ts` | schema version, localStorage keys, themes и player defaults |
| `lib/storage.ts` | localStorage helpers, document/snapshot migrations, PUT helper |
| `lib/anime.ts` | поиск, franchise/grouping, прогресс, resume и форматирование |
| `lib/tracking.ts` | episode keys, reconciliation, sort и acknowledge |
| `lib/ratings.ts` | rating tree, averages и mapping внешних источников |
| `lib/kodik.ts` | iframe identity/URL и нормализация Kodik postMessage fields |
| `lib/kodikStream.ts` | typed запрос прямого потока и кратковременный cache ссылок |
| `lib/playerPreferences.ts` | приоритет любимой озвучки и плеера тайтла |
| `lib/watchPartyLogic.ts` | user-change/target/revision guards |
| `lib/gdrive.ts` | typed frontend client `/api/gdrive/*` |
| `lib/events.ts` | typed event map и emit/listen adapters |
| `lib/debugLog.ts` | кольцевой журнал UI/fetch событий |
| `lib/changelog.ts` | данные встроенного changelog |
| `lib/trailer.ts` | выбор trailer/preview для домашнего hero |

## Стили

Все CSS-файлы расположены в `app/frontend/src/styles/`. `globals.css` и
`styles/base.css` задают порядок импорта; тематические файлы не импортируются
из компонентов. Детальная карта каждого файла, токенов и runtime-стилей — в
[`STYLES.md`](STYLES.md).

## Инструменты

| Путь | Назначение |
| --- | --- |
| `app/tools/transfer_saves.py` | проверяемый двусторонний перенос полного сохранения с backup |
| `app/tools/prepare_runtime.py` | hash-based install/build только при изменении входов source runtime |
| `app/tools/split-base-css.mjs` | механическое разбиение исторического base CSS |
| `app/tools/format-css.mjs` | форматирование CSS через frontend script `format:css` |
| `app/frontend/tests/critical-logic.test.ts` | регрессии чистой клиентской логики |

## Где вносить изменение

| Требование | Первое место поиска |
| --- | --- |
| новый внутренний маршрут | `backend/app/api/` + `docs/API_REFERENCE.md` |
| новый внешний запрос | `backend/app/services/` и feature `api.ts` |
| новое поле сохранения | `lib/types.ts`, `lib/storage.ts`, `features/storage/profileDocument.ts` |
| изменение merge | `services/gdrive_merge.py` + `test_gdrive.py` |
| изменение прогресса | `lib/anime.ts`, `features/player/activeWatchActions.ts`, `Player.tsx` |
| новая страница | `pages/`, типизированная model/actions, координатор `App.tsx` |
| новая настройка | `features/settings/`, `lib/settings.ts`, при хранении — data docs |
| визуальное изменение | определить владельца в `docs/STYLES.md`, затем соответствующий CSS |
