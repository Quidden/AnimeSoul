# Стили AnimeSoul

Все стили актуального React-приложения глобальные: CSS Modules, CSS-in-JS и
component-level imports не используются. Единственная TypeScript-точка входа —
`app/frontend/src/main.tsx`, импортирующая `src/globals.css`.

## Цепочка подключения

```text
main.tsx
└─ globals.css
   ├─ styles/base.css
   │  ├─ base-core.css
   │  ├─ base-home-dashboard.css
   │  ├─ base-navigation.css
   │  ├─ base-guides.css
   │  ├─ base-catalog.css
   │  ├─ base-settings-base.css
   │  ├─ base-settings-modal.css
   │  ├─ base-personalization.css
   │  ├─ base-collections.css
   │  ├─ base-feedback.css
   │  ├─ base-cloud.css
   │  ├─ base-branding.css
   │  ├─ base-settings-center.css
   │  └─ downloads.css
   ├─ styles/library.css
   ├─ styles/player.css
   ├─ styles/system-panels.css
   ├─ styles/home-redesign.css
   ├─ styles/ratings.css
   ├─ styles/player-toolbar.css
   ├─ styles/custom-player.css
   └─ styles/mobile-android.css
```

Порядок является частью визуального контракта. Файл ниже по списку может
уточнять селектор файла выше. `home-redesign.css` специально загружается после
старых layout bundles, чтобы cinematic home перекрывал только свои классы.

`styles/base.css` — только импортный манифест. Не добавляйте в него selectors.

## Базовые токены

`base-core.css` определяет:

```css
:root {
  --bg: #09080d;
  --panel: #141218;
  --line: #2c2732;
  --ink: #f5f1fa;
  --muted: #9a94a2;
  --accent: #9a78ff;
}
```

| Переменная | Назначение | Кто меняет runtime |
| --- | --- | --- |
| `--bg` | основной фон | theme effect в `useProfileStorage` |
| `--panel` | общие панели | только CSS default |
| `--line` | нейтральные границы | только CSS default |
| `--ink` | основной текст | только CSS default |
| `--muted` | вторичный текст | только CSS default |
| `--accent` | кнопки, focus, progress, badges | theme effect |
| `--accent-soft` | полупрозрачный accent | theme effect как `${accent}33` |

Не все исторические selectors уже переведены на tokens: часть файлов содержит
конкретные dark colors. Светлая тема поэтому дополняется отдельными
`html[data-color-scheme="light"] ...` overrides в `base-catalog.css` и
`base-settings-base.css`.

## Runtime-персонализация

### Theme

Effect `features/storage/useProfileStorage.ts` при изменении `Theme`:

```text
theme.accent     -> --accent
theme.accent+33  -> --accent-soft
theme.background -> --bg и body.style.backgroundColor
brightness       -> html.dataset.colorScheme = light|dark
brightness       -> html.style.colorScheme
```

Theme хранится в профиле и localStorage mirror. Presets находятся в
`lib/settings.ts`; custom colors меняет `AppearanceSettings.tsx`.

### Размеры и цвет просмотренного

Player preferences устанавливают:

| CSS variable | Поле `PlayerPrefs` | CSS fallback | Основной потребитель |
| --- | --- | --- | --- |
| `--watched-episode-color` | `watchedEpisodeColor` | `var(--accent)` | `.episode-grid button.watched` |
| `--interface-font-scale` | `interfaceFontScale` | `1` | тексты карточек/списков/toolbar |
| `--heading-font-scale` | `headingFontScale` | `1` | `.section-head h2`, watch headings |
| `--poster-scale` | `posterScale` | `1` | `.poster` |
| `--preview-scale` | `previewScale` | `1` | `.hero-episode-preview` |

Selectors находятся в `base-personalization.css`. Значение `1` сохраняет
исходный дизайн.

### Desktop zoom

`app/run.py::DESKTOP_ZOOM_SCRIPT` существует вне CSS bundle и применяется
только к PyWebView:

- хранит `animesoul.desktop.interfaceScale` в localStorage;
- `Ctrl` + wheel меняет 0.5–2.0 шагом 0.1;
- `Ctrl+0` возвращает 1;
- устанавливает `document.documentElement.style.zoom`;
- создаёт собственный inline-индикатор масштаба.

Это дополнительный масштаб поверх CSS variables. После изменения layout нужно
проверять как browser 100%, так и desktop zoom 50/100/200%.

## Владельцы CSS-файлов

Разбиение `base-*` сохраняет исторический каскад. Границы уже тематические, но
не полностью строгие: один UI может иметь базовый selector в раннем файле и
позднее уточнение в другом. При поиске учитывайте весь import order.

### Манифест `base.css`

| Файл | Ответственность | Характерные selectors / потребители |
| --- | --- | --- |
| `base-core.css` | tokens, reset, body, общий app shell, primitives, карточки/кнопки/modals | `:root`, `.app`, `.anime-card`, `.cards`, `.hero`, `.modal`, `.primary`, `.poster` |
| `base-home-dashboard.css` | общие dashboard blocks и progress primitives | `.hero-widgets`, `.hero-box`, `.mini-list`, `.folder-progress`, `.wide-progress`, `.collection-grid` |
| `base-navigation.css` | поиск, suggestions, filter/control layouts, folder/detail navigation, широкие responsive overrides | `.search-wrap`, `.suggestions`, `.theme-palette`, `.folder-view`, `.filter-panel`, `.config-tools` |
| `base-guides.css` | expandable guides, дополнительные панели каталога/просмотра и исторические UI refinements | `.catalog-guide`, `.catalog-guide-content`, `.extra-panel`, `.folder-anime-list` |
| `base-catalog.css` | catalog page, watching/list cards, random/filter details и общая light-theme коррекция | `.catalog-page`, `.watching-section`, `.watching-list`, `.random-panel`, `html[data-color-scheme="light"]` |
| `base-settings-base.css` | базовый settings modal, groups/items/toggles/themes и light settings | `.settings-modal`, `.settings-group`, `.settings-item`, `.toggle-row`, `.settings-themes` |
| `base-settings-modal.css` | viewport/portal layer, header/actions/scroll и modal responsive | `.settings-modal-backdrop`, `.settings-header-actions`, `.settings-reset`, `.player-options` |
| `base-personalization.css` | CSS-variable driven user sizes/color | `.watched`, `.poster`, `.hero-episode-preview`, headings/text scales |
| `base-collections.css` | полноэкранный обзор favorites/folders/tracking и resume actions | `.collection-overview-*`, `.overview-remove`, `.hero-resume-label` |
| `base-feedback.css` | спокойные общие статусы local/API/cloud/party | `.status-popover`, `.cloud-sync-card`, `.loading`, `.ready`, `.synced`, `.error` |
| `base-cloud.css` | Google Drive card, OAuth form, sync choices и cloud state | `.google-drive-settings`, `.cloud-settings-*`, `.cloud-oauth-*` |
| `base-branding.css` | общий знак AnimeSoul и release/rewatch badges | `.brand`, `.track-ep-badge`, `.track-total-new`, `.rewatch-count` |
| `base-settings-center.css` | новая двухколоночная навигация настроек, search и workspace overrides | `.settings-layout`, `.settings-tabs`, `.settings-search`, `.settings-workspace`, `.settings-panel-heading` |
| `downloads.css` | offline library, очередь, карточки загрузок и download settings | `.downloads-*`, `.offline-*` |

### Feature bundles после base

| Файл | Ответственность | Главные потребители/classes |
| --- | --- | --- |
| `library.css` | библиотека, collapse transitions, tracking/history, статистика и activity calendar | `HomePage`, `LibrarySections`, `StatisticsPage`; `.activity-*`, `.history-*`, `.tracking-*`, `.collapse-*`, `.genre-stats` |
| `player.css` | watch layout, iframe, toolbar, seasons, episode carousel/preview, Watch Party | `Player`, `SeasonList`, `PlayerToolbar`, `WatchPartyPanel`, `EpisodeHoverPreview`; `.player-*`, `.season-*`, `.episode-*`, `.watch-party-*` |
| `system-panels.css` | changelog, debug console, system overlays и служебные статусы | `ChangelogModal`, `DebugPanel`; `.changelog-*`, `.debug-*` |
| `home-redesign.css` | cinematic hero и новая композиция главной | `HomeHero`, `DashboardWidgets`, `LibrarySections`, `FAQBlock`; `.home-cinema-*`, `.home-dashboard-*`, `.home-*` |
| `ratings.css` | page/table/tree/picker общих и личных оценок | `RatingsPage`, `RatingBoard`, `ScorePicker`; `.ratings-*`, `.rating-*`, `.score-picker` |
| `player-toolbar.css` | окончательная раскладка toolbar и download controls вокруг video | `PlayerToolbar`; `.player-toolbar-*`, `.toolbar-*` |
| `custom-player.css` | controls, menus, subtitles и состояния собственного HLS-плеера | `AnimeSoulPlayer`, `AnimeSoulPlayerMenus`; `.animesoul-player-*` |
| `mobile-android.css` | поздние Android/mobile overrides и safe-area variables | Android WebView; `html[data-platform="android"]`, `.animesoul-native-pip` |

## Привязка UI → stylesheet

| Что меняется | Сначала открыть |
| --- | --- |
| root/body/buttons/cards/modal primitive | `base-core.css` |
| Header search/status/navigation | `base-navigation.css`, затем `base-feedback.css` и `Header.tsx` |
| Catalog filters/cards/light theme | `base-catalog.css`, базовые карточки также `base-core.css` |
| Home cinematic layout | `home-redesign.css` |
| Favorites/history/tracking/statistics | `library.css`; overview modal — `base-collections.css` |
| Player/seasons/episode preview/party | `player.css`; personalization — `base-personalization.css` |
| Settings shell/tabs | `base-settings-base.css`, `base-settings-modal.css`, `base-settings-center.css` |
| Google Drive | `base-cloud.css`; общий status — `base-feedback.css` |
| Ratings | `ratings.css` |
| Debug/changelog | `system-panels.css` |
| Logo/badges | `base-branding.css` |

Если selector найден в нескольких файлах, побеждает specificity, затем более
поздний import. Проверяйте `rg -n "\.имя-класса" app/frontend/src/styles`.

## Responsive правила

Проект использует локальные media queries, а не единый breakpoint registry.
Наиболее частые пороги: 550, 600, 640, 700/720, 760, 800, 860/900, 980/1000,
1050, 1100, 1200, 1250 и 1350 px.

Особые случаи:

- `player.css` имеет `(hover:none)` для отключения hover preview на touch;
- `player.css` учитывает `prefers-reduced-motion: reduce`;
- `home-redesign.css` использует `100svh` для мобильной высоты hero;
- settings modal имеет отдельные 860/760/600 layouts;
- desktop minimum window — 960×640, но browser может быть уже.

При изменении компонента проверьте media queries в том же файле и более поздних
bundles, которые используют тот же class.

## Inline и вычисляемые стили

Inline style допустим там, где значение является данными/координатой, а не
статическим оформлением.

| Место | Динамическое значение | Почему inline |
| --- | --- | --- |
| `AnimeCard`, `FolderView`, `CollectionOverview`, `LibrarySections`, `SeasonList`, `DashboardWidgets` | width progress bar | процент из runtime данных |
| `StatisticsPage` | grid columns, bar width/height | вычисленная шкала графика |
| `EpisodeHoverPreview` | `left`, `top` | pointer/viewport position |
| `AppearanceSettings` | preview gradient | выбранные theme colors |
| `GoogleDriveInitialSyncModal` | overlay/dialog objects | изолированный blocking modal; кандидат на перенос в `base-cloud.css` |
| `run.py::DESKTOP_ZOOM_SCRIPT` | zoom indicator и root zoom | код инжектируется после загрузки WebView |
| `backend/app/api/gdrive.py` | OAuth callback page | HTML формируется backend вне React bundle |
| `launcher.py::LAUNCHER_HTML` | полный launcher stylesheet | отдельное локальное WebView-приложение, не React SPA |

Статические `cursor`, color, padding и layout следует держать в CSS. Например,
inline `cursor` в `Header.tsx` — историческое исключение, не шаблон для новых
компонентов.

## Launcher и OAuth styles

В проекте есть две независимые поверхности, не входящие в `globals.css`:

1. `app/launcher.py::LAUNCHER_HTML` содержит собственный `<style>` для
   настроечного WebView launcher. Его classes не должны совпадать по смыслу с
   React CSS только ради переиспользования: документы загружаются раздельно.
2. `app/backend/app/api/gdrive.py::oauth2callback` возвращает маленькую HTML
   success/error page со встроенными styles. Она существует только в OAuth
   popup и не получает React bundle.

Изменение бренда/цветов нужно проверить во всех трёх поверхностях: React,
launcher, OAuth callback.

## Naming и ownership

- Используйте kebab-case classes.
- Для крупной feature-поверхности предпочтителен prefix:
  `home-*`, `settings-*`, `cloud-*`, `rating-*`, `watch-party-*`, `debug-*`.
- State class (`active`, `error`, `watched`) должен применяться только вместе с
  parent/feature selector, иначе глобальная коллизия неизбежна.
- Общий primitive размещается в `base-core.css`; feature selector — в самом
  позднем тематическом файле владельца.
- Не импортируйте CSS из leaf-компонента без изменения всей стратегии, иначе
  Vite order начнёт зависеть от component graph.
- Не создавайте новый глобальный class, пока не проверили совпадения `rg`.

## `!important` и исторический каскад

В существующих `base-*` файлах есть `!important`, появившиеся до тематического
разбиения. Они поддерживают прежний каскад, light theme и поздние layout
уточнения. Новое `!important` допустимо только с комментарием о конфликтующей
поверхности. Предпочтительный путь — правильный owner/import order и достаточно
узкий selector.

Не удаляйте существующий `!important` механически: сначала найдите все selectors
того же элемента и проверьте desktop/mobile/light states.

## Как добавить или изменить стиль

1. Найдите class в JSX и во всех CSS-файлах через `rg`.
2. Выберите владельца по таблице выше.
3. Проверьте, нет ли более позднего override в import chain.
4. Для пользовательского значения используйте существующий CSS token или
   добавьте новый с fallback и установкой в одном effect.
5. Добавьте responsive/focus/disabled/light/reduced-motion состояния, если они
   применимы.
6. Запустите форматирование и сборку:

```powershell
npm --prefix app/frontend run format:css
npm --prefix app/frontend run audit:css
npm --prefix app/frontend run typecheck
npm --prefix app/frontend run build
```

7. Визуально проверьте минимум: desktop 1440 px, окно 960×640, mobile ≤600 px,
   тёмную/светлую тему и PyWebView zoom.

## Как добавить stylesheet

Новый файл нужен только при ясном новом владельце. Подключите его в
`globals.css` либо `base.css` в осознанной позиции, обновите import diagram в
этом документе и проверьте, какие существующие selectors он перекрывает.
Простое увеличение размера CSS не является причиной добавлять ещё один файл.
