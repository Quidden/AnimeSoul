[English](README.md) | [Русский](README.ru.md)

# Документация AnimeSoul

Актуальная реализация `app/`, версия **0.3.0**, схема **3**. Сверено с кодом **26 сентября 2026 года**. Английский — основной язык; русские пары имеют суффикс `.ru.md`. Пути в тексте относятся к корню репозитория, если не указано иначе.

## Навигация

| Document | English | Русский |
| --- | --- | --- |
| Запуск, разработка и проверки | [EN](DEVELOPMENT.md) | [RU](DEVELOPMENT.ru.md) |
| Аккаунты сайта, PostgreSQL, роли и развёртывание | [EN](deployment/WEBSITE.md) | [RU](deployment/WEBSITE.ru.md) |
| Архитектура и границы | [EN](architecture/ARCHITECTURE.md) | [RU](architecture/ARCHITECTURE.ru.md) |
| План миграции: стек, мобильный клиент, SEO, безопасность, админка и платежи | [EN](architecture/WEB_STACK_PLAN.md) | [RU](architecture/WEB_STACK_PLAN.ru.md) |
| Технический обзор и инварианты | [EN](architecture/TECHNICAL_DOCUMENTATION.md) | [RU](architecture/TECHNICAL_DOCUMENTATION.ru.md) |
| UI, навигация, состояние, события и нативные мосты | [EN](frontend/UI.md) | [RU](frontend/UI.ru.md) |
| Сервисы, жизненный цикл, конкурентность и ошибки | [EN](architecture/BACKEND.md) | [RU](architecture/BACKEND.ru.md) |
| HTTP/WS: запросы, ответы, вызовы, ошибки и примеры | [EN](api/API_REFERENCE.md) | [RU](api/API_REFERENCE.ru.md) |
| Полный перечень маршрутов/обработчиков и моделей из кода | [EN](api/API_SCHEMA.md) | [RU](api/API_SCHEMA.ru.md) |
| Точки входа и сквозные цепочки функций | [EN](architecture/ENTRY_POINTS_AND_FLOWS.md) | [RU](architecture/ENTRY_POINTS_AND_FLOWS.ru.md) |
| Файлы и владельцы функциональности | [EN](architecture/PROJECT_MAP.md) | [RU](architecture/PROJECT_MAP.ru.md) |
| Схема, версии полей, файлы устройства и миграции | [EN](architecture/DATA_MODEL.md) | [RU](architecture/DATA_MODEL.ru.md) |
| OAuth, режимы sync, конфликты и восстановление | [EN](guides/GDRIVE_SYNC.md) | [RU](guides/GDRIVE_SYNC.ru.md) |
| Локальные устройства, сейвы, передача видео и пульт | [EN](guides/LAN_DEVICES.md) | [RU](guides/LAN_DEVICES.ru.md) |
| Порядок CSS, токены, владельцы и адаптивность | [EN](frontend/STYLES.md) | [RU](frontend/STYLES.ru.md) |
| Сборки Windows/Android, нативные возможности и проверка | [EN](platforms/PLATFORMS.md) | [RU](platforms/PLATFORMS.ru.md) |
| Импорт/экспорт, перенос legacy и резервные копии | [EN](guides/SAVE_COMPATIBILITY.md) | [RU](guides/SAVE_COMPATIBILITY.ru.md) |
| Android runtime, фоновые загрузки и Cast | [EN](platforms/ANDROID.md) | [RU](platforms/ANDROID.ru.md) |
| Постоянная подпись Android и обновление поверх | [EN](platforms/ANDROID_UPDATE_SIGNING.md) | [RU](platforms/ANDROID_UPDATE_SIGNING.ru.md) |
| Галерея и происхождение снимков | [EN](screenshots/SCREENSHOTS.md) | [RU](screenshots/SCREENSHOTS.ru.md) |
| Текущие границы и следующие этапы рефакторинга | [EN](architecture/REFACTORING_RECOMMENDATIONS.md) | [RU](architecture/REFACTORING_RECOMMENDATIONS.ru.md) |

## Поддержка документации

Документация упорядочена **6 октября 2026 года**. Поддерживаемые инструкции хранятся в `docs/`, история релизов — в `docs/releases/`, макеты — в `docs/design/`. Результаты сборок и проверок размещаются в игнорируемом `artifacts/`, архивная реализация — в `archive/legacy-old-stack/`. План миграции задаёт целевую структуру нового `main`, отдельный мобильный репозиторий и этапы перехода; реализация миграции и переключателя YummyAnime ещё не начата.

Из `app/`: `python tools/check_docs.py` проверяет пары языков, локальные ссылки и соответствие таблицы маршрутам. После изменения API выполните `python tools/check_docs.py --write-api`, затем дополните ручные описания и обе языковые версии. Автоматическая таблица не заменяет описание динамических JSON-ответов.

Релизные заметки также доступны на английском и русском и описывают историческое поведение. Архив `archive/legacy-old-stack/` не описывает текущую реализацию. UI приложения преимущественно русский; двуязычность документации не означает локализацию интерфейса.

## История релизов

| Version | English | Русский |
| --- | --- | --- |
| 0.3.0 | [EN](releases/RELEASE_0.3.0.md) | [RU](releases/RELEASE_0.3.0.ru.md) |
| 0.2.9 | [EN](releases/RELEASE_0.2.9.md) | [RU](releases/RELEASE_0.2.9.ru.md) |
| 0.2.8 | [EN](releases/RELEASE_0.2.8.md) | [RU](releases/RELEASE_0.2.8.ru.md) |
| 0.2.7 | [EN](releases/RELEASE_0.2.7.md) | [RU](releases/RELEASE_0.2.7.ru.md) |
| 0.2.6 | [EN](releases/RELEASE_0.2.6.md) | [RU](releases/RELEASE_0.2.6.ru.md) |
| 0.2.5 | [EN](releases/RELEASE_0.2.5.md) | [RU](releases/RELEASE_0.2.5.ru.md) |
| 0.2.4 | [EN](releases/RELEASE_0.2.4.md) | [RU](releases/RELEASE_0.2.4.ru.md) |
| 0.2.3 | [EN](releases/RELEASE_0.2.3.md) | [RU](releases/RELEASE_0.2.3.ru.md) |
| 0.2.2 | [EN](releases/RELEASE_0.2.2.md) | [RU](releases/RELEASE_0.2.2.ru.md) |
| 0.2.1 | [EN](releases/RELEASE_0.2.1.md) | [RU](releases/RELEASE_0.2.1.ru.md) |
| 0.2.0 | [EN](releases/RELEASE_0.2.0.md) | [RU](releases/RELEASE_0.2.0.ru.md) |
| 0.1.9-beta.2 | [EN](releases/RELEASE_0.1.9-beta.2.md) | [RU](releases/RELEASE_0.1.9-beta.2.ru.md) |
| 0.1.9-beta.1 | [EN](releases/RELEASE_0.1.9-beta.1.md) | [RU](releases/RELEASE_0.1.9-beta.1.ru.md) |

## Discord

[Настройка активности Discord, ограничения и отключение модуля](guides/DISCORD.ru.md).
