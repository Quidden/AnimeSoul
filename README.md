# AnimeSoul

AnimeSoul — локальное приложение для каталога, просмотра и ведения личной
аниме-библиотеки. Актуальная реализация находится в [`app/`](app/): интерфейс
на React/TypeScript работает с локальным FastAPI-сервером и открывается в
браузере либо в окне PyWebView.

| Каталог | Статус | Назначение |
| --- | --- | --- |
| [`app/`](app/) | актуальный | Python + FastAPI + React + Vite + PyWebView |
| [`legacy-old-stack/`](legacy-old-stack/) | архив | прежний Vinext/Electron-стек, оставленный для миграции сохранений и справки |

Новая функциональность разрабатывается только в `app/`. Изменять
`legacy-old-stack/` следует лишь ради совместимости или исправления критической
уязвимости старой версии.

## Запуск

В Windows запустите [`Start AnimeSoul.bat`](Start%20AnimeSoul.bat). Скрипт
передаёт управление актуальному приложению, устанавливает недостающие
зависимости, собирает интерфейс и запускает сохранённый режим.

Для исходной сборки нужны Python 3.11+, Node.js 22+ и личный **Public token**
YummyAnime. Private token приложению не нужен и не должен попадать в конфиг.

Инструкции по запуску, разработке и проверкам находятся в
[`app/README.md`](app/README.md).

## Документация

Единый индекс: [`app/docs/README.md`](app/docs/README.md).

- [`app/docs/TECHNICAL_DOCUMENTATION.md`](app/docs/TECHNICAL_DOCUMENTATION.md) — технический обзор и границы системы;
- [`app/docs/API_REFERENCE.md`](app/docs/API_REFERENCE.md) — все внутренние маршруты, поля запросов/ответов и используемые поля внешнего API;
- [`app/docs/ENTRY_POINTS_AND_FLOWS.md`](app/docs/ENTRY_POINTS_AND_FLOWS.md) — точки входа/выхода и цепочки функций;
- [`app/docs/PROJECT_MAP.md`](app/docs/PROJECT_MAP.md) — назначение каталогов и файлов;
- [`app/docs/DATA_MODEL.md`](app/docs/DATA_MODEL.md) — схема сохранения, локальное состояние и миграции;
- [`app/docs/STYLES.md`](app/docs/STYLES.md) — каскад CSS, токены, владельцы стилей и динамическое оформление.

Документы внутри `legacy-old-stack/` описывают только архивную реализацию и не
являются руководством по текущему коду.

## Перенос сохранений

Один профиль переносится через экспорт/импорт в настройках. Полный документ со
всеми профилями переносится утилитой после закрытия обеих версий:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

Утилита проверяет источник, создаёт резервную копию существующего назначения и
заменяет файл атомарно. Подробности: [`app/SAVE_COMPATIBILITY.md`](app/SAVE_COMPATIBILITY.md).
