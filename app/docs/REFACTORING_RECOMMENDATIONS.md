# План дальнейшего рефакторинга AnimeSoul

Документ относится к актуальному `app/` и описывает безопасные границы
следующих изменений. Рефакторинг не должен незаметно менять пользовательское
поведение, сетевые контракты или формат сохранения.

## Неприкосновенные правила

1. Новая продуктовая логика добавляется в `app/`, не в `legacy-old-stack/`.
2. Schema 3 остаётся читаемой обеими реализациями. Неизвестные поля должны
   переживать migration, save, cloud merge и import/export.
3. HTTP/WS contract меняется только вместе со всеми callers, tests и
   [`API_REFERENCE.md`](API_REFERENCE.md).
4. Нельзя молча менять progress, rewatch, tracking, Watch Party или Drive merge
   под видом перемещения кода.
5. Перемещение/переименование не меняет product version и schema version.
6. Порядок CSS imports сохраняется, пока визуальный diff не доказал
   эквивалентность.

## Уже выполненные границы

### Frontend

- Transport каталога вынесен в `features/catalog/api.ts`.
- Catalog request/filter state находится в `useCatalogController`.
- Franchise/card presentation находится в `useCatalogPresentation`.
- Tracking transport находится в `features/tracking/api.ts`.
- Watch Party transport/types отделены в `features/watch-party/`.
- Library/history/statistics calculations находятся в чистых selectors.
- Profile document construction/resolution находится в
  `features/storage/profileDocument.ts`.
- Profile lifecycle, migration, mirror и persistence находятся в
  `features/storage/useProfileStorage.ts`.
- Ratings transport/retry находятся в `features/ratings/`.
- Settings разбиты на catalog, common row, appearance, profiles и cloud.
- Player presentation частично разбит на toolbar, season list, schedule,
  metadata и Watch Party panel.
- Home, catalog, ratings, statistics и folder имеют page boundaries.
- Typed browser events определены в `lib/events.ts`.
- CSS base разделён на ordered `base-*` modules; feature bundles сохранены.

`App.tsx`, `Player.tsx` и `SettingsCenter.tsx` остаются orchestration shells.
Это осознанно: их следует уменьшать по одной проверяемой ответственности.

### Backend

- Routes являются transport adapters.
- External/file/room logic находится в services.
- Drive merge выделен в pure `gdrive_merge.py` и тестируется без сети.
- Community ratings отделены в SQLite store и aggregate API.
- Runtime instance ownership отделён от launcher/runtime UI.

## Целевое направление

```text
pages/components -> feature hooks/controllers -> feature domain/API -> lib contracts
FastAPI routes   -> use-case coordination      -> services/pure policy -> I/O
```

Не нужна абстракция ради симметрии. Новый слой оправдан, если он убирает
несколько связанных решений из UI/router и даёт самостоятельный тест.

## Этап 1: завершить anime detail boundary

Сейчас `Watch` и часть detail composition остаются большим экраном. Нужно
выделить typed page/view model, сохранив lifetime iframe в player feature.

Кандидаты:

- family/load state;
- detail metadata и rating view model;
- folder/favorite/tracking actions;
- route/back intent.

Критерии:

- page не читает `StorageDocument` напрямую;
- `App.tsx` передаёт model/actions, а не десятки взаимозависимых state setters;
- открытие card/resume/new episode остаётся различимым;
- catalog/resume tests проходят без изменения.

## Этап 2: разделить player orchestration

`Player.tsx` должен остаться владельцем iframe lifetime, но из него можно
выделить hooks:

- selection season/episode/dub/source;
- family video loading/retry/normalization;
- resume и progress commit;
- auto-next и fullscreen transition policy;
- Kodik message adapter;
- preview loading/positioning.

Не создавайте один глобальный player context: скрытые зависимости усложнят
защиту от Watch Party feedback loop.

Критерии:

- manual selection и auto-next остаются разными командами;
- watched episode можно воспроизвести повторно;
- resume возвращает правильный origin anime/episode и timestamp;
- remote party command не публикуется обратно;
- provider без postMessage по-прежнему встраивается.

## Этап 3: завершить SettingsCenter

`SettingsCenter.tsx` уже делегирует appearance, profiles и Drive. Оставить в
shell только modal navigation, search и composition, вынеся:

- watching/player setting groups;
- Watch Party settings/guide;
- reset command;
- focus/overlay lifecycle при необходимости в modal hook.

Критерии:

- одна canonical label/description/search entry на настройку;
- persisted setting имеет owner в `lib/settings.ts`/data docs;
- закрытие modal не кликает фоновые элементы;
- cloud UI рендерится только из `useGoogleDriveSettings` state;
- reset покрыт migration/component test.

## Этап 4: формализовать persistence commands

Заменить разбросанные state mutations именованными pure commands:

```text
markEpisodeWatched
updateEpisodeProgress
removeFavorite
deleteFolder / restoreFolder
updateTrackingBaseline
setPersonalRating
```

Command принимает snapshot/domain state и возвращает новый объект. Одна
persistence boundary пишет документ.

Критерии:

- одно пользовательское действие создаёт один итоговый save;
- unknown snapshot fields не теряются;
- Unicode notes/names проходят round-trip;
- concurrent progress/settings cloud cases покрыты tests.

## Этап 5: backend use cases только для сложной координации

Простые health/proxy routes оставлять простыми. Use-case функция уместна там,
где route координирует несколько ресурсов:

- cloud restore/merge/upload;
- initial OAuth cloud inspection;
- Watch Party host transfer;
- при появлении server-side tracking — его refresh.

Критерии:

- route разбирает request и переводит errors;
- use case описывает последовательность;
- service владеет I/O;
- pure policy не знает FastAPI/httpx/filesystem.

## Этап 6: усилить CSS ownership

Первичное разбиение выполнено, но часть одинаковых selectors распределена между
`base-*` modules и поздними feature bundles. Продолжать постепенно по одному UI.

Правила:

- tokens/reset/primitives — `base-core.css`;
- settings/cloud/ratings/player/home selectors — у feature owner;
- `base.css` остаётся только manifest;
- новый state class scope-ится feature parent;
- существующий `!important` удаляется только после поиска всех overrides.

Критерии:

- для изменяемой feature один очевидный owner;
- import order и light theme не ломаются;
- responsive, reduced-motion, touch и desktop zoom проверены;
- [`STYLES.md`](STYLES.md) обновлён одновременно.

## Этап 7: усилить контракты API

Некоторые routes принимают свободный `dict`, особенно Watch Party и storage.
После стабилизации callers можно добавить Pydantic models без изменения JSON.

Приоритет:

1. request/response models для Watch Party;
2. ограниченный storage envelope model с `extra=allow`;
3. typed Yummy proxy discriminated responses;
4. OpenAPI examples и stable error models.

Критерии:

- extra/unknown storage fields разрешены;
- legacy caller contract не отклоняется;
- generated `/openapi.json` согласован с ручным справочником;
- validation status и error body покрыты tests.

## Как выполнить один безопасный срез

1. Зафиксировать текущее поведение test или небольшой characterization fixture.
2. Выбрать один owner и одну ответственность.
3. Переместить pure logic первой, transport/lifecycle — отдельным шагом.
4. Не менять одновременно формат данных, UI и route contract.
5. Запустить точечные tests, затем полный набор.
6. Обновить `PROJECT_MAP`, flows/API/data/styles по затронутой границе.
7. Проверить diff: refactor не должен содержать случайное форматирование
   несвязанных файлов.

## Обязательная проверка

```powershell
cd app
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Для затронутой подсистемы дополнительно:

| Подсистема | Проверить вручную/тестом |
| --- | --- |
| storage | import/export, profile switch, unknown fields, backend 404 bootstrap |
| progress | resume, manual toggle rollback, rewatch, franchise origin |
| tracking | selected/all dubs, partial API failure, acknowledge |
| party | host/shared, follow/free, transfer, stale participant, protocol mismatch |
| Drive | local/cloud/merge/anime_only, deletion, timestamp, queue coalescing |
| ratings | score removal/offline tombstone, aggregate isolation, cookie |
| CSS | dark/light, 1440/960/600, touch hover, desktop 50/100/200% |

## Документация как acceptance criterion

Рефакторинг считается завершённым только когда документация по-прежнему
указывает фактического владельца:

- файл переехал — `PROJECT_MAP.md`;
- цепочка изменилась — `ENTRY_POINTS_AND_FLOWS.md`;
- contract изменился — `API_REFERENCE.md`;
- данные изменились — `DATA_MODEL.md`;
- cascade/owner изменился — `STYLES.md`.
