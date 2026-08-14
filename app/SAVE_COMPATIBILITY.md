# Совместимость и перенос сохранений

Актуальный Python/React-стек и архивный Vinext/Electron-стек используют общий
versioned JSON document схемы **3**. Перенос возможен в обе стороны, но перед
операцией оба приложения нужно полностью закрыть.

## Что переносится

Полный `animesoul-storage.json` содержит:

- все профили и активный profile ID;
- избранное, папки, порядок и заметки;
- прогресс, позиции, завершения и пересмотры;
- личные оценки;
- tracking baselines и выбранные озвучки;
- тему, положение toolbar и player preferences;
- настройки истории и библиотечных секций.

`snapshot.animeTitles` и `progress[animeId].title` дублируют читаемое название
для удобства просмотра JSON. Идентичность всегда определяется numeric anime ID;
редактирование подписи не переносит progress на другой тайтл.

Не входят в portable document:

- YummyAnime token и машинный port;
- Google credentials/tokens и состояние первой синхронизации;
- community ratings database и anonymous voter cookie;
- runtime state, debug log и Watch Party session;
- desktop zoom текущего устройства.

## Вариант 1: один профиль через интерфейс

1. Откройте исходную версию и нужный профиль.
2. В настройках профилей выберите экспорт конфигурации.
3. Сохраните `AnimeSoul-<имя>.json`.
4. В целевой версии выберите импорт и этот файл.
5. Задайте имя нового профиля и при необходимости сразу переключитесь.

Экспорт содержит один `ConfigSnapshot`, а не всю оболочку. Импорт создаёт новый
profile UUID и не заменяет другие профили. Способ удобен для установленной
сборки и другого компьютера.

## Вариант 2: полный документ между каталогами репозитория

Из legacy в текущий source data:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
```

Из текущего source data в legacy:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

Фиксированные пути утилиты:

```text
legacy-old-stack/data/animesoul-storage.json
app/data/animesoul-storage.json
```

Утилита не определяет `%LOCALAPPDATA%` и custom `data_directory`. Для
установленной сборки используйте UI export/import либо заранее скопируйте полный
файл между фактическим data-каталогом и `app/data` при закрытом приложении.

## Что делает transfer tool

`app/tools/transfer_saves.py`:

1. Проверяет существование source.
2. Разбирает UTF-8 JSON.
3. Проверяет root object, `profiles: array`, `activeProfile: string`,
   `schemaVersion: integer`.
4. Если destination существует, копирует его в
   `animesoul-storage.backup-YYYYMMDD-HHMMSS-microseconds.json`.
5. Сериализует полный source document во временный
   `animesoul-storage.json.transfer.tmp`.
6. Атомарно заменяет destination.

Source не изменяется. Неизвестные вложенные поля сохраняются на уровне модели
данных, хотя whitespace/форматирование JSON нормализуются.

## Автоматический первый импорт

`backend/app/services/storage.py::JsonStorage.read` при отсутствии main save
проверяет `legacy-old-stack/data/animesoul-storage.json`. Корректный документ
копируется в current data directory.

- импорт выполняется только если current save отсутствует;
- существующий current document никогда не перезаписывается;
- legacy source не удаляется и не редактируется;
- повреждённый legacy JSON игнорируется.

## Гарантии совместимости

- Оба frontend понимают schema version 3.
- Известные поля получают безопасные defaults при migration.
- Неизвестные root/profile/snapshot fields сохраняются при обычной загрузке,
  автоматической записи и profile round-trip.
- Backend main-версии валидирует оболочку, но не удаляет незнакомое содержимое.
- Transfer tool переносит весь document без выборочного преобразования.
- Google Drive merge начинает с unknown fields выбранной стороны и применяет
  явные правила к известным collections.

Совместимость означает «файл можно открыть и вернуть без молчаливой потери
неизвестных полей». Возможность новой функции в старом UI не гарантируется:
старая версия просто не показывает то, чего не понимает.

## Device-specific настройки после переноса

Проверьте отдельно:

- `watchPartyServer`: адрес может быть недоступен на другом компьютере;
- Google Drive: подключается заново на целевом устройстве;
- port и YummyAnime Public token: находятся в машинном config, не в профиле;
- desktop zoom и раскрытые локальные панели: часть состояния имеет device-first
  приоритет.

## Ручное копирование

Если нужно перенести полный файл из установленной сборки:

1. Узнайте `data_directory` в её `animesoul.python.json`.
2. Закройте launcher, browser/desktop client и runtime server.
3. Создайте отдельную копию destination.
4. Проверьте source как JSON с root `schemaVersion`, `activeProfile`, `profiles`.
5. Скопируйте с именем `animesoul-storage.json`.
6. Запустите целевую версию и экспортируйте один profile как дополнительную
   проверку.

Не редактируйте/не заменяйте файл, пока FastAPI process работает: следующий
debounced save может перезаписать ручное изменение состоянием из памяти.

## Восстановление

После ошибочного transfer:

1. Закройте обе версии.
2. Переименуйте повреждённый destination для диагностики, не удаляя его сразу.
3. Найдите самый свежий `*.backup-*.json`.
4. Скопируйте/переименуйте его обратно в `animesoul-storage.json`.
5. Запустите только целевую версию и проверьте активный профиль.

Если backup отсутствует, используйте UI export, cloud copy или исходный файл
другой реализации. Google Drive full restore выполняйте только после проверки,
какая сторона содержит нужные изменения.

Полная структура полей: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). Правила
облачного конфликта: [`docs/GDRIVE_SYNC.md`](docs/GDRIVE_SYNC.md).
