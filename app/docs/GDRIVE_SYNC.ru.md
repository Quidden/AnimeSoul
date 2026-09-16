[English](GDRIVE_SYNC.md) | [Русский](GDRIVE_SYNC.ru.md)

# Google Drive: OAuth, синхронизация и слияние

Владельцы: `api/gdrive.py`, общий `services/gdrive.py::get_gdrive_service`, чистый `gdrive_merge.py`, `lib/gdrive.ts`, `useGoogleDriveSettings`, `useHeaderCloudSync`. [API](API_REFERENCE.ru.md) · [Данные](DATA_MODEL.ru.md).

## Файлы и ключи

Режим visible использует `AnimeSoul/animesoul-storage.json`; appdata — Drive appDataFolder. Сохранённый `gdrive-credentials.json` имеет приоритет над environment/config, в том числе поддерживает форму Google installed client. Пустой secret сохраняет имеющийся. API записывает credentials только при всех valid checks; изменение resolved credentials отключает прежние tokens. Ключи не входят в профиль/экспорт/status.

## Жизненный цикл авторизации

1. В «Настройки → Ключи» укажите OAuth-клиент и проверьте его.
2. Запросите auth-url с реальным callback URI; по умолчанию origin backend + `/api/gdrive/oauth2callback`.
3. Браузер открывает Google consent: scopes drive.file, drive.appdata, userinfo.email, offline access и consent.
4. Callback потребляет одноразовый in-memory state с TTL 10 минут. Реализован authorization code без PKCE.
5. Desktop меняет code на tokens, получает userinfo, проверяет cloud и сохраняет tokens. HTML отправляет `GDRIVE_AUTH_SUCCESS` в opener со строгим origin.
6. Android может сохранить code/redirect в pending OAuth и обменять после foreground через `/complete-auth`. Lock объединяет deep-link и foreground-попытки; transient transport failure оставляет действующий pending code для повтора.
7. Status показывает connected/oauth_pending/choice_pending и результат sync. HTTP-успех HTML callback сам по себе не подтверждает OAuth.

Disconnect пытается revoke токена у Google и всегда очищает локальные tokens/pending. Поле revoked показывает результат отзыва. Сохранённый OAuth client и cloud-файл остаются; облачная копия не удаляется.

## Первый выбор облачных данных

Если обнаружено облачное сохранение, `choice_pending` блокирует автоматическую выгрузку **на backend и в UI**. PUT storage по-прежнему сохраняет локально, но возвращает cloud_sync_blocked. Explicit sync даёт 409 до явного выбора с `resolve_initial_choice:true`; auto для первого выбора запрещён (422). Старый tab/таймер не может обойти защиту.

## Режимы

```json
{"mode":"merge","prefer_watched":true,"folder_mode":"visible","resolve_initial_choice":false}
```

| Mode | Локальный результат | Облачный результат |
| --- | --- | --- |
| local | Исходный документ | Полная замена локальным документом |
| cloud | Проверенный cloud document, предыдущий файл сохраняется как backup | Исходный cloud |
| merge | Объединённый документ | Тот же объединённый документ |
| anime_only | Объединённый документ с локальными theme/playerPrefs | Тот же документ |
| auto | Upload при пустом cloud; merge при наличии обеих сторон; restore, если есть только cloud | Зависит от ветки |

Ответ: status uploaded/downloaded/merged, document, optional file_id и backup при восстановлении. Нет tokens → 401; нет cloud для restore → 444; нет локального источника upload → 409; повреждённый local → 500 до изменения cloud. Направления local/cloud заменяют одну сторону; UI запрашивает осознанный выбор.

## Метки времени и приоритет

`updatedAt` документа определяет приоритет оболочки. ISO, Unix seconds и JS milliseconds нормализуются в секунды; невалидное/отсутствующее значение даёт 0, при равенстве побеждает local.

Для коллекций и настроек применяется **собственная** `snapshot.fieldUpdatedAt[field]`, а время документа служит fallback для старых файлов. `buildProfileSnapshot → changedFieldRevisions` обновляет только изменённые поля. Поэтому новый progress save на старом устройстве не откатывает недавно выбранную тему.

Отслеживаются favorites, folders, progress, ratings, tracked, theme, toolbar, playerPrefs, historyClearedAt, historyEnabled, libraryExpanded, watchingExpanded, historyExpanded и watchingHidden. Результат fieldUpdatedAt сохраняет максимумы нормализованных меток.

## Правила merge

| Область | Правило |
| --- | --- |
| Envelope | Неизвестные поля нового документа поверх старого; schemaVersion max; updatedAt выбранного нового |
| Profiles | Union ID: сначала local, затем отсутствующие cloud. Tombstone удаления профиля нет; неверный activeProfile заменяется существующим ID |
| Unknown profile/snapshot fields | Приоритет выбранного документа; anime_only начинает с локального приоритета |
| Favorites | Целый список из более новой revisions favorites; без выбранного источника sorted union |
| Folders | ID-сопоставление; membership/order/animeIds из более новой folders revision; без источника union; notes объединяются с приоритетом source |
| Tracking | Membership/dubs/pending из более новой tracked revision; известные anime/episode keys объединяются; счётчики пересчитываются/max; check/new timestamps max |
| Progress | Union anime ID; максимальный resetAt отбрасывает серии с updatedAt <= resetAt; оставшиеся episode keys объединяются |
| Выбор активной серии | Метаданные AnimeProgress берутся от стороны с наиболее поздней серией/сбросом; при равенстве local |
| EpisodeState | Общие поля от нового updatedAt; уникальная отсортированная completionHistory; max completions/watchedSeconds/duration; position от нового record, сохраняя перемотку назад |
| Watched flags | OR completed/manuallyCompleted при prefer_watched=true; иначе новое состояние |
| Legacy time | Максимум при наличии поля |
| Ratings | Целая map от новой ratings revision, сохраняя удаление; без источника union ID и больший rating.updatedAt, local на равенстве |
| animeTitles | Union с приоритетом выбранного документа; дополнение progress.title; anime_only даёт приоритет local |
| watchingHidden | Список от новой watchingHidden revision либо union без источника |
| Настройки | theme/toolbar/playerPrefs/history/layout сравниваются отдельно по revisions |
| anime_only | Сохраняет локальные theme/playerPrefs; результат остаётся полным StorageDocument, а не только progress |

Merge не является безусловным union всех коллекций: membership определяется версией конкретного поля. `resetAt` предотвращает возврат сброшенных серий из старого устройства; новые записи после сброса сохраняются.

## Автосинхронизация и очередь

| UI mode | Поведение |
| --- | --- |
| instant | Debounced local PUT просит cloud scheduling после первого выбора |
| interval | PUT локальный; useHeaderCloudSync вызывает merge каждые выбранные 1/5/15/30/60 минут |
| manual | Выгрузка только явными командами; локальная запись продолжается |

`schedule_write` копирует latest pending document, не создавая второй worker при работающем первом. Worker перечитывает latest local, читает cloud, объединяет, отправляет cloud, затем записывает merged local только при отсутствии более нового save за время сети. Новый pending повторяет цикл. Ошибка сохраняет pending для следующей попытки и публикует last_sync_error.

Header сразу и каждые 2.5 секунды опрашивает status; открытые настройки добавляют свой polling. После успешного sync frontend делает reloadStorage. sync_running/sync_pending, last_sync_started_at/last_sync_at и last_sync_error различают локальную запись и подтверждённую выгрузку.

## Проверка и восстановление

`backend/tests/test_gdrive.py` и `test_storage_safety.py` проверяют удаления, timestamps/revisions, prefer_watched, anime_only, очередь, первый выбор, reset и повреждённые документы. OAuth, сеть и Android foreground проверяются отдельно. При ошибке upload локальная запись остаётся. После ошибочного restore закройте runtime и восстановите backup. Просроченный/использованный state требует нового URL входа.
