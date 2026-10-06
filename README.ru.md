[English](README.md) | [Русский](README.ru.md)

# AnimeSoul [Full AI]

**Личная аниме-библиотека, просмотр и история — на вашем устройстве.**

AnimeSoul — локальное приложение для поиска аниме, просмотра серий и ведения личной библиотеки. Интерфейс React + TypeScript работает с Python/FastAPI в браузере, desktop-окне Windows или самостоятельном Android-приложении.

[Скачать релизы](https://github.com/Quidden/AnimeSoul/releases) · [Начало работы](docs/DEVELOPMENT.ru.md) · [Техническая документация](docs/README.ru.md) · [HTTP API](docs/api/API_REFERENCE.ru.md)

## Кратко о проекте

| | |
| --- | --- |
| Версия | **0.3.0**; схема профиля **3** |
| Клиенты | Браузер / PyWebView на Windows; Android WebView + встроенный Python |
| Интерфейс | React 19, TypeScript 5.9, Vite 8, глобальный CSS, hls.js |
| Бэкенд | FastAPI, Uvicorn, httpx; JSON и SQLite для кеша/оценок |
| Режим сайта | Аккаунты, сессии, роли и профили с PostgreSQL; [развёртывание](docs/deployment/WEBSITE.ru.md) |
| Интеграции | YummyAnime, Kodik, Jikan для дат серий, Google Drive, экспериментальный Google Cast на Android |
| Документация | Английский (основной) и русский; интерфейс приложения преимущественно русский |

## Возможности

- **Поиск:** исправление раскладки, транслитерация, псевдонимы, фильтры и группировка франшиз.
- **Просмотр:** сезоны, серии, озвучки, источники и продолжение с сохранённого момента; собственный HLS-плеер с качеством, субтитрами, скоростью, предпросмотром шкалы, пропуском опенинга/эндинга и Picture-in-Picture при поддержке платформы.
- **Библиотека:** избранное, папки, заметки, несколько профилей, история, статистика, ручные отметки и пересмотры.
- **Новые серии:** отслеживание франшизы и выбранных озвучек с учётом исходной идентичности серии и доступных дат выхода.
- **Офлайн:** очередь загрузок, выбор сезонов и диапазонов, статистика места и просмотр сохранённых файлов. Android публикует готовые MP4 через MediaStore.
- **Сохранения:** импорт/экспорт профилей, синхронизация Google Drive с явными правилами слияния и восстановления.
- **Устройства в локальной сети:** явная привязка, автоматическая синхронизация сейвов параллельно с Google Drive, перенос скачанных MP4 и пульт с разрешениями и приоритетами. [Настройка и ограничения](docs/guides/LAN_DEVICES.ru.md).
- **Оценки:** личные оценки тайтлов, сезонов и серий; анонимные агрегаты подключённого сервера AnimeSoul.
- **Совместный просмотр:** комнаты с управлением хоста или участников на desktop/в браузере. В Android Watch Party отключён.
- **Трансляция Android:** экспериментальный Google Cast для прямых онлайн HTTPS HLS/MP4; телефон передаёт телевизору ссылку потока.

## Скриншоты

### Библиотека Windows

<img width="2500" height="1314" alt="Библиотека AnimeSoul на Windows" src="https://github.com/user-attachments/assets/68aa5d34-ccf9-4c0d-8cca-c6f6d47eea1b" />

### Настройки просмотра и оформления

![Настройки просмотра и продолжения](docs/screenshots/desktop-settings.png)

![Темы и размеры интерфейса](docs/screenshots/desktop-appearance.png)

### Android

<p align="center">
  <img src="docs/screenshots/android-home.png" alt="Главная и библиотека Android" width="320">
  <img src="docs/screenshots/android-mini-player.png" alt="Мини-плеер Android" width="320">
</p>

[Галерея и условия съёмки](docs/screenshots/SCREENSHOTS.ru.md). Снимки показывают русский UI; язык документации не переключает язык приложения.

## Начало работы

Готовые сборки Windows и Android доступны в [GitHub Releases](https://github.com/Quidden/AnimeSoul/releases). Для запуска исходников на Windows откройте [Start AnimeSoul.bat](Start%20AnimeSoul.bat): скрипт подготовит зависимости, при необходимости пересоберёт frontend и запустит сохранённый режим.

Для исходников нужны **Python 3.11+ и Node.js 22+**; CI использует Python 3.12. Для каталога YummyAnime настройте свой **Public token**. Для прямого плеера и загрузок Kodik нужна собственная пара Public/Private. Приватный токен YummyAnime не используется. Google Drive подключается по желанию через собственный OAuth-клиент.

Подробности: [установка, разработка и проверки](docs/DEVELOPMENT.ru.md), [сборки платформ](docs/platforms/PLATFORMS.ru.md), [подпись обновлений Android](docs/platforms/ANDROID_UPDATE_SIGNING.ru.md).

## Связи компонентов

```mermaid
flowchart LR
    Client["React: браузер / PyWebView / Android WebView"] -->|"локальный HTTP JSON"| API["Маршруты FastAPI"]
    API --> Services["Сервисы Python"]
    Services --> Providers["YummyAnime / Kodik / Jikan"]
    Services --> Data["Профили JSON / SQLite / офлайн-файлы"]
    Services --> Cloud["Google OAuth / Drive"]
    Services --> Party["Watch Party в памяти; только desktop"]
    Client -->|"медиа / iframe"| Media["CDN / плеер источника"]
    Client -->|"мост Android"| Native["PiP / MediaSession / MediaStore / Cast"]
```

Бэкенд управляет каталогом, ключами, файлами и синхронизацией. Видео, постеры и iframe источников могут загружаться непосредственно клиентом. Общие оценки относятся к текущему серверу, а не к глобальному сервису AnimeSoul. Комнаты и очередь загрузок находятся в памяти процесса и не переживают его перезапуск.

## Документация

[План нового стека сайта, отдельного Android-клиента, SEO, безопасности и платежей](docs/architecture/WEB_STACK_PLAN.ru.md) описывает следующий этап развития; текущая реализация пока работает на прежнем стеке.

| Раздел | English | Русский |
| --- | --- | --- |
| Оглавление | [Index](docs/README.md) | [Оглавление](docs/README.ru.md) |
| Архитектура и границы | [Architecture](docs/architecture/ARCHITECTURE.md) | [Архитектура](docs/architecture/ARCHITECTURE.ru.md) |
| UI, состояние, события | [Frontend](docs/frontend/UI.md) | [Интерфейс](docs/frontend/UI.ru.md) |
| Сервисы и жизненный цикл | [Backend](docs/architecture/BACKEND.md) | [Бэкенд](docs/architecture/BACKEND.ru.md) |
| HTTP / WS, запросы и ошибки | [API](docs/api/API_REFERENCE.md) | [API](docs/api/API_REFERENCE.ru.md) |
| Функции и цепочки вызовов | [Flows](docs/architecture/ENTRY_POINTS_AND_FLOWS.md) | [Цепочки](docs/architecture/ENTRY_POINTS_AND_FLOWS.ru.md) |
| Данные и синхронизация | [Data](docs/architecture/DATA_MODEL.md) · [Drive](docs/guides/GDRIVE_SYNC.md) | [Данные](docs/architecture/DATA_MODEL.ru.md) · [Drive](docs/guides/GDRIVE_SYNC.ru.md) |
| Карта кода, CSS, платформы | [Map](docs/architecture/PROJECT_MAP.md) · [CSS](docs/frontend/STYLES.md) · [Platforms](docs/platforms/PLATFORMS.md) | [Карта](docs/architecture/PROJECT_MAP.ru.md) · [CSS](docs/frontend/STYLES.ru.md) · [Платформы](docs/platforms/PLATFORMS.ru.md) |

## Структура репозитория

| Каталог | Назначение |
| --- | --- |
| [`app/`](app) | Поддерживаемая реализация Python/FastAPI + React, упаковка Windows и клиент Android |
| [`archive/legacy-old-stack/`](archive/legacy-old-stack) | Архив Vinext/Electron для миграции и справки |
| [`docs/`](docs/README.ru.md) | Инструкции, архитектура, API, платформы, история релизов и макеты |
| `artifacts/` | Игнорируемые Git сборки, промежуточные файлы и снимки интерфейса |
| [`.github/workflows/`](.github/workflows) | CI на Windows: Ruff, unittest бэкенда и проверки frontend |

Новая функциональность разрабатывается в `app/`. Документы legacy относятся к архиву. Заметки о релизах описывают исторические версии и не заменяют актуальный контракт API.

## Перенос сохранений

Один профиль переносится через «Настройки → Профили». Полный документ между текущим и legacy-каталогом переносится после закрытия обоих runtime командой из `app/`:

```powershell
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
# Обратное направление:
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

Утилита проверяет документ, создаёт резервную копию назначения и заменяет файл атомарно. Ключи и скачанные видео хранятся отдельно от профиля. [Совместимость сохранений](docs/guides/SAVE_COMPATIBILITY.ru.md) описывает произвольные пути, установленную версию и восстановление.

Спасибо разработчикам YummyAnime за API, благодаря которому появился AnimeSoul. Доступность видео, озвучек, субтитров, кадров и качества зависит от внешних источников.
