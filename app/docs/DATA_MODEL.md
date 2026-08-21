# Данные, сохранение и локальное состояние AnimeSoul

Источник типов frontend — `app/frontend/src/lib/types.ts`, defaults и ключей —
`app/frontend/src/lib/settings.ts`. Текущая версия схемы документа и профиля —
**3**.

## Где хранятся данные

| Среда | Конфигурация | Основные данные |
| --- | --- | --- |
| запуск из исходников | `app/animesoul.python.json` | `app/data/` по умолчанию |
| установленная Windows-сборка | `%LOCALAPPDATA%\AnimeSoul\animesoul.python.json` | `%LOCALAPPDATA%\AnimeSoul\data\` |
| явный CLI config | путь из `run.py --config` | `data_directory` из этого JSON |

Файлы data-каталога:

| Файл | Формат | Владелец | Назначение |
| --- | --- | --- | --- |
| `animesoul-storage.json` | JSON UTF-8 | `JsonStorage` | профили, библиотека, прогресс и переносимые настройки |
| `animesoul-storage.tmp.json` | JSON UTF-8 | `JsonStorage` | временный файл атомарной записи |
| `gdrive-credentials.json` | JSON | `GoogleDriveService` | OAuth `client_id`/`client_secret` текущего устройства |
| `gdrive-tokens.json` | JSON | `GoogleDriveService` | access/refresh tokens, user info и cached sync status |
| `community-ratings.sqlite3` | SQLite WAL | `CommunityRatingStore` | анонимные оценки текущего сервера |

Рядом с машинным config runtime публикует `animesoul.runtime.json`. Это не
пользовательское сохранение, а подтверждение владельца процесса.

## Машинная конфигурация

Пример:

```json
{
  "port": 8000,
  "yummy_public_token": "personal-public-token",
  "data_directory": "data",
  "launch_mode": "desktop",
  "gdrive_client_id": "",
  "gdrive_client_secret": ""
}
```

| Поле | Default | Использование |
| --- | --- | --- |
| `port` | `8000` в source runtime, `3001` в packaged launcher | loopback FastAPI port |
| `yummy_public_token` | пусто | Public token для header `X-Application` |
| `data_directory` | `data`/путь LocalAppData | data-каталог |
| `launch_mode` | `browser` | `browser` или `desktop` |
| `gdrive_client_id` | пусто | fallback OAuth client |
| `gdrive_client_secret` | пусто | optional fallback secret |

Поддерживается legacy-имя `yummyAnimeToken`. Приоритет имеет environment,
затем JSON:

| Environment | Что переопределяет |
| --- | --- |
| `ANIMESOUL_CONFIG_FILE` | путь config |
| `ANIMESOUL_PYTHON_PORT` | `port` |
| `YUMMYANIME_TOKEN` | Public token |
| `GOOGLE_CLIENT_ID` | Drive Client ID |
| `GOOGLE_CLIENT_SECRET` | Drive Client Secret |
| `ANIMESOUL_DATA_DIR` | data-каталог |
| `ANIMESOUL_FRONTEND_DIST` | production bundle |
| `ANIMESOUL_INSTANCE_ID` | instance ID в health/runtime |
| `ANIMESOUL_RUNTIME_STATE_FILE` | явный runtime state path |

`backend/app/config.py` также читает `app/.env`, не перезаписывая уже заданные
environment values.

## Runtime state

`runtime_instance.write_runtime_state` записывает атомарно:

```json
{
  "instance_id": "uuid-or-hex",
  "pid": 1234,
  "port": 8000,
  "mode": "browser",
  "started_at": "2026-08-14T00:00:00+00:00"
}
```

Launcher разрешает остановку только когда `instance_id`, `pid` и `port`
совпадают с `/api/health` и runtime state. При нормальном завершении файл
удаляется только владельцем того же `instance_id`.

## StorageDocument

```ts
type StorageDocument = {
  schemaVersion: number;
  updatedAt: string;
  activeProfile: string;
  profiles: ConfigProfile[];
  [unknownField: string]: unknown;
};

type ConfigProfile = {
  id: string;
  name: string;
  snapshot: ConfigSnapshot;
  [unknownField: string]: unknown;
};
```

| Поле | Смысл |
| --- | --- |
| `schemaVersion` | версия оболочки, сейчас 3 |
| `updatedAt` | ISO timestamp сборки документа; используется для cloud last-writer policy |
| `activeProfile` | ID профиля, который следует загрузить |
| `profiles` | полные переносимые профили |

`migrateDocument` всегда обеспечивает хотя бы профиль `default`, проверяет
существование `activeProfile`, мигрирует каждый snapshot и сохраняет неизвестные
root/profile fields через object spread.

## ConfigSnapshot

```ts
type ConfigSnapshot = {
  version: number;
  name: string;
  createdAt: string;
  favorites: number[];
  folders: Folder[];
  progress: Progress;
  ratings: UserRatings;
  animeTitles?: Record<number, string>;
  tracked: Tracker[];
  theme: Theme;
  toolbar: "top" | "bottom" | "left" | "right";
  playerPrefs?: PlayerPrefs;
  historyClearedAt?: number;
  historyEnabled?: boolean;
  libraryExpanded?: boolean;
  watchingExpanded?: boolean;
  historyExpanded?: boolean;
  watchingHidden?: number[];
};
```

| Поле | Для чего нужно |
| --- | --- |
| `version` | версия переносимого профиля, нормализуется к 3 |
| `name`, `createdAt` | метаданные профиля/экспорта |
| `favorites` | уникальные anime ID в избранном |
| `folders` | коллекции пользователя и заметки |
| `progress` | активная серия и состояние каждой серии |
| `ratings` | личное дерево оценок, входит в portable profile |
| `animeTitles` | читаемые подписи для JSON; логика остаётся ID-based |
| `tracked` | подписки и baselines новых серий |
| `theme` | переносимые цвета темы |
| `toolbar` | положение панели плеера |
| `playerPrefs` | переносимые настройки просмотра/UI |
| `history*`, `*Expanded`, `watchingHidden` | история и состояние библиотечных секций |

`buildProfileSnapshot` начинает с `...previous`, поэтому неизвестные snapshot
fields переживают обычное сохранение. Известные поля затем заменяются актуальным
React state.

## Папки

```ts
type Folder = {
  id: string;
  name: string;
  animeIds: number[];
  notes?: Record<number, string>;
};
```

`id` создаётся через `crypto.randomUUID()` при отсутствии. `notes` связываются
с numeric anime ID. Удаление тайтла из папки не удаляет его progress.

## Прогресс просмотра

```ts
type Progress = Record<number, AnimeProgress>;

type AnimeProgress = {
  title?: string;
  episode: string;
  dub: string;
  episodes: Record<string, EpisodeState>;
  totalEpisodes?: number;
  totalDuration?: number;
  season?: number;
  seasonLabel?: string;
  originAnimeId?: number;
  originEpisode?: string;
};
```

Ключ `Progress` — основной anime ID. Ключ `episodes` обычно имеет форму
`<season>:<episode>`. `title` — читаемая метаинформация, не ключ.

```ts
type EpisodeState = {
  position: number;
  duration: number;
  percent: number;
  updatedAt: number;
  originAnimeId?: number;
  originEpisode?: string;
  completed?: boolean;
  completions?: number;
  completionHistory?: number[];
  rewatchArmed?: boolean;
  watchedSeconds?: number;
  manuallyCompleted?: boolean;
  manualPrevious?: {
    position: number;
    duration: number;
    percent: number;
    updatedAt: number;
    originAnimeId?: number;
    originEpisode?: string;
    completed?: boolean;
    completions?: number;
    completionHistory?: number[];
    rewatchArmed?: boolean;
    watchedSeconds?: number;
  };
};
```

| Поле | Семантика |
| --- | --- |
| `position`, `duration`, `percent` | последняя известная позиция и доля |
| `updatedAt` | конфликтный приоритет и выбор resume |
| `originAnimeId`, `originEpisode` | исходная запись YummyAnime внутри объединённой франшизы |
| `completed` | серия считается просмотренной |
| `completions` | количество завершений/пересмотров |
| `completionHistory` | timestamps завершений в миллисекундах |
| `rewatchArmed` | серия возвращена к началу и готова считать новое завершение |
| `watchedSeconds` | реально накопленное время для статистики |
| `manuallyCompleted` | отметка сделана вручную |
| `manualPrevious` | состояние для точного отката ручной отметки |

`latestResumePoint` выбирает незавершённую/актуальную серию по времени
обновления, а `episodeResumePosition` не продолжает завершённую серию с самого
конца. Ручная отметка проходит через `toggleEpisodeWatched` и может быть
отменена через `manualPrevious`.

## Tracking

```ts
type Tracker = {
  animeId: number;
  animeIds?: number[];
  title: string;
  knownEpisodes: number;
  knownEpisodeKeys?: string[];
  pendingEpisodeKeys?: string[];
  newEpisodes: number;
  knownAnyEpisodeKeys?: string[];
  pendingOtherDubEpisodeKeys?: string[];
  otherDubEpisodes?: number;
  dubs?: string[];
  lastCheckedAt?: number;
  lastNewEpisodeAt?: number;
};
```

- `animeId` — корень подписки; `animeIds` — все известные элементы франшизы.
- `knownEpisodeKeys`/`pendingEpisodeKeys` относятся к выбранным озвучкам.
- `knownAnyEpisodeKeys`/`pendingOtherDubEpisodeKeys` дают сигнал, что серия уже
  существует, но ещё не появилась в выбранной озвучке.
- Полностью неуспешний tracking snapshot не заменяет baseline.
- Проверка запускается сразу, пропускает запись моложе 240 секунд и повторяется
  каждые 300 секунд.

## Личные и общие оценки

Portable личная оценка:

```ts
type AnimeUserRatings = {
  title?: string;
  anime?: number;
  seasons: Record<string, number>;
  episodes: Record<string, number>;
  updatedAt?: number;
};
```

Score лежит в диапазоне 1–10. Season key — номер строкой, episode key —
`<season>:<episode>`. `updatedAt` определяет победителя при cloud merge.

Общая оценка не входит в профиль. `community-ratings.sqlite3` хранит одну
заменяемую запись на `(voter_id, anime_id)`, а API отдаёт только:

```ts
type CommunityRatingSummary = { average: number; count: number };
```

и дерево aggregate по anime/season/episode. Удаление всех личных score
публикуется как пустое дерево и удаляет серверную запись этого browser.

## Theme и PlayerPrefs

```ts
type Theme = { name: string; accent: string; background: string };
```

Preset themes: Аметист, Сакура, Океан, Манго, Светлая. Custom theme получает
имя `Своя`. Применение к CSS описано в [`STYLES.md`](STYLES.md).

Все поля `PlayerPrefs`:

| Поле | Тип/default | Назначение |
| --- | --- | --- |
| `autoSkipOpening` | boolean / `false` | автоматический пропуск опенинга |
| `autoSkipEnding` | boolean / `false` | автоматический пропуск эндинга |
| `autoNext` | boolean / `true` | переход к следующей серии |
| `autoPlayResume` | boolean / `true` | автозапуск продолжения |
| `autoScrollPlayer` | boolean / `true` | прокрутка к плееру |
| `homeEpisodePreview` | boolean / `true` | preview продолжения на главной |
| `homePreviewMode` | `screenshots|poster` / `poster` | тип preview |
| `playerEpisodeCarousel` | boolean / `true` | карусель серий |
| `episodeHoverPreview` | boolean / `true` | preview при наведении |
| `watchedEpisodeColor` | string / `#9a78ff` | CSS-цвет просмотренной серии |
| `interfaceFontScale` | number / `1` | обычный текст |
| `headingFontScale` | number / `1` | заголовки |
| `posterScale` | number / `1` | постеры |
| `previewScale` | number / `1` | preview продолжения |
| `favoriteDubbings` | string[] / `[]` | упорядоченное общее избранное озвучек |
| `titleDubbings` | Record<string,string> / `{}` | любимая озвучка конкретного тайтла |
| `titlePlayers` | Record<string,string> / `{}` | выбранный плеер конкретного тайтла |
| `watchPartyEnabled` | boolean / `false` | UI/логика комнат |
| `watchPartyServer` | string / current origin | адрес сервера комнаты |
| `watchPartyName` | string / `Участник` | имя участника |
| `watchPartyMode` | `follow|free` / `follow` | следовать playback или смотреть свободно |
| `watchPartyRoomMode` | `host|shared` / `host` | кто может управлять комнатой |
| `watchPartyDubMode` | `own|suggest|follow` / `suggest` | политика озвучки |
| `watchPartyPanelPosition` | `top|bottom|overlay` / `bottom` | размещение панели комнаты |
| `watchPartyAutoCatchUp` | boolean / `true` | автоматически догонять host |

## localStorage mirror и device state

`useProfileStorage` сначала восстанавливает browser mirror, затем пытается
загрузить файловый документ. Файл — основной переносимый источник; mirror
позволяет пережить временную недоступность backend и мигрировать старые данные.

### Portable/profile mirrors

| Ключ | Значение |
| --- | --- |
| `animesoul:favorites` | `number[]` |
| `animesoul:folders` | `Folder[]` |
| `animesoul:progress-v2` | `Progress` |
| `animesoul:ratings-v1` | `UserRatings` |
| `animesoul:tracked` | `Tracker[]` |
| `animesoul:theme` | `Theme` |
| `animesoul:toolbar` | toolbar position |
| `animesoul:player-prefs` | `PlayerPrefs` |
| `animesoul:profiles` | `ConfigProfile[]` |
| `animesoul:active-profile` | profile ID string |
| `animesoul:history-cleared-at` | timestamp ms |
| `animesoul:history-enabled` | boolean |
| `animesoul:section-library-expanded` | boolean |
| `animesoul:section-watching-expanded` | boolean |
| `animesoul:section-history-expanded` | boolean |
| `animesoul:watching-hidden` | `number[]` |

Раскрытие секций имеет device-first приоритет при обычной загрузке. При явном
переключении/импорте профиля может применяться snapshot layout.

### Device-only/UI keys

| Ключ | Назначение |
| --- | --- |
| `animesoul:last-deleted-folder` | последний удалённый folder + index для Undo |
| `animesoul:collapsed-seasons:<anime_id>` | свёрнутые сезоны конкретного player |
| `animesoul:debug-log:v1` | локальный журнал диагностики |
| `animesoul:save-status` | опубликованный UI status локальной записи |
| `animesoul:api-status` | latency/status YummyAnime |
| `animesoul:community-ratings-published-v1` | последний опубликованный `updatedAt` по anime |
| `animesoul:community-rating-removals-v1` | offline tombstones оценок |
| `animesoul:gdrive-folder-mode` | `visible|appdata` |
| `animesoul:gdrive-prefer-watched` | merge preference |
| `animesoul:gdrive-auto-sync-mode` | `instant|interval|manual` |
| `animesoul:gdrive-auto-sync-interval` | минуты, 1/5/15/30/60 |
| `animesoul:gdrive-initial-choice-done` | локальный guard первого merge |
| `animesoul:gdrive-has-cloud-file` | cached status для save guard |
| `animesoul.desktop.interfaceScale` | zoom desktop WebView, 0.5–2.0 |

`sessionStorage` ключ `animesoul:watch-party-session` содержит только текущие
`roomId`, `token`, `role` и исчезает вместе с browser session.

## Миграция

`migrateSnapshot`:

- устанавливает версию 3 и defaults;
- фильтрует ID до finite numbers;
- нормализует folders, progress, ratings и tracking collections;
- дополняет `PlayerPrefs` всеми defaults;
- сохраняет неизвестные поля через `...input`;
- не доверяет типам JSON для критических коллекций.

`migrateDocument` мигрирует каждый profile и исправляет отсутствующий active ID.
Backend специально не дублирует эту доменную миграцию.

## Запись и восстановление

`JsonStorage.write` сериализует JSON с `ensure_ascii=False`, записывает
`animesoul-storage.tmp.json` и атомарно заменяет основной файл. Async lock не
даёт двум progress updates смешать содержимое.

При первом `read`, если основного файла нет, сервис пытается скопировать
`legacy-old-stack/data/animesoul-storage.json`. Существующий main-файл никогда
не перезаписывается этим импортом.

Полный двусторонний перенос с backup описан в
[`../SAVE_COMPATIBILITY.md`](../SAVE_COMPATIBILITY.md), cloud merge — в
[`GDRIVE_SYNC.md`](GDRIVE_SYNC.md).

## Правило изменения схемы

Перед добавлением поля:

1. Добавьте TypeScript-тип и безопасный default/normalizer.
2. Убедитесь, что `buildProfileSnapshot` сохраняет поле и неизвестные поля.
3. Определите cloud merge policy, если простого last-writer недостаточно.
4. Добавьте round-trip, migration и merge тесты.
5. Обновите этот документ и API-справочник, если поле пересекает HTTP.
6. Повышайте schema version только при реальном изменении формата, а не при
   перемещении файлов или компонентов.
