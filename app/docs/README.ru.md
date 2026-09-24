[English](README.md) | [Русский](README.ru.md)

# Документация AnimeSoul

Актуальная реализация `app/`, версия **0.2.8**, схема **3**. Сверено с кодом **24 сентября 2026 года**. Английский — основной язык; русские пары имеют суффикс `.ru.md`. Пути в тексте относятся к корню репозитория, если не указано иначе.

## Навигация

| Document | English | Русский |
| --- | --- | --- |
| Запуск, разработка и проверки | [EN](../README.md) | [RU](../README.ru.md) |
| Архитектура и границы | [EN](../ARCHITECTURE.md) | [RU](../ARCHITECTURE.ru.md) |
| Технический обзор и инварианты | [EN](TECHNICAL_DOCUMENTATION.md) | [RU](TECHNICAL_DOCUMENTATION.ru.md) |
| UI, навигация, состояние, события и нативные мосты | [EN](UI.md) | [RU](UI.ru.md) |
| Сервисы, жизненный цикл, конкурентность и ошибки | [EN](BACKEND.md) | [RU](BACKEND.ru.md) |
| HTTP/WS: запросы, ответы, вызовы, ошибки и примеры | [EN](API_REFERENCE.md) | [RU](API_REFERENCE.ru.md) |
| Полный перечень маршрутов/обработчиков и моделей из кода | [EN](API_SCHEMA.md) | [RU](API_SCHEMA.ru.md) |
| Точки входа и сквозные цепочки функций | [EN](ENTRY_POINTS_AND_FLOWS.md) | [RU](ENTRY_POINTS_AND_FLOWS.ru.md) |
| Файлы и владельцы функциональности | [EN](PROJECT_MAP.md) | [RU](PROJECT_MAP.ru.md) |
| Схема, версии полей, файлы устройства и миграции | [EN](DATA_MODEL.md) | [RU](DATA_MODEL.ru.md) |
| OAuth, режимы sync, конфликты и восстановление | [EN](GDRIVE_SYNC.md) | [RU](GDRIVE_SYNC.ru.md) |
| Локальные устройства, сейвы, передача видео и пульт | [EN](LAN_DEVICES.md) | [RU](LAN_DEVICES.ru.md) |
| Порядок CSS, токены, владельцы и адаптивность | [EN](STYLES.md) | [RU](STYLES.ru.md) |
| Сборки Windows/Android, нативные возможности и проверка | [EN](PLATFORMS.md) | [RU](PLATFORMS.ru.md) |
| Импорт/экспорт, перенос legacy и резервные копии | [EN](../SAVE_COMPATIBILITY.md) | [RU](../SAVE_COMPATIBILITY.ru.md) |
| Android runtime, фоновые загрузки и Cast | [EN](../mobile/README.md) | [RU](../mobile/README.ru.md) |
| Постоянная подпись Android и обновление поверх | [EN](../mobile/UPDATE_SIGNING.md) | [RU](../mobile/UPDATE_SIGNING.ru.md) |
| Галерея и происхождение снимков | [EN](SCREENSHOTS.md) | [RU](SCREENSHOTS.ru.md) |
| Текущие границы и следующие этапы рефакторинга | [EN](REFACTORING_RECOMMENDATIONS.md) | [RU](REFACTORING_RECOMMENDATIONS.ru.md) |

## Поддержка документации

Из `app/`: `python tools/check_docs.py` проверяет пары языков, локальные ссылки и соответствие таблицы маршрутам. После изменения API выполните `python tools/check_docs.py --write-api`, затем дополните ручные описания и обе языковые версии. Автоматическая таблица не заменяет описание динамических JSON-ответов.

Релизные заметки также доступны на английском и русском и описывают историческое поведение. Архив `legacy-old-stack/` не описывает текущую реализацию. UI приложения преимущественно русский; двуязычность документации не означает локализацию интерфейса.

## История релизов

| Version | English | Русский |
| --- | --- | --- |
| 0.2.8 | [EN](../RELEASE_0.2.8.md) | [RU](../RELEASE_0.2.8.ru.md) |
| 0.2.7 | [EN](../RELEASE_0.2.7.md) | [RU](../RELEASE_0.2.7.ru.md) |
| 0.2.6 | [EN](../RELEASE_0.2.6.md) | [RU](../RELEASE_0.2.6.ru.md) |
| 0.2.5 | [EN](../RELEASE_0.2.5.md) | [RU](../RELEASE_0.2.5.ru.md) |
| 0.2.4 | [EN](../RELEASE_0.2.4.md) | [RU](../RELEASE_0.2.4.ru.md) |
| 0.2.3 | [EN](../RELEASE_0.2.3.md) | [RU](../RELEASE_0.2.3.ru.md) |
| 0.2.2 | [EN](../RELEASE_0.2.2.md) | [RU](../RELEASE_0.2.2.ru.md) |
| 0.2.1 | [EN](../RELEASE_0.2.1.md) | [RU](../RELEASE_0.2.1.ru.md) |
| 0.2.0 | [EN](../RELEASE_0.2.0.md) | [RU](../RELEASE_0.2.0.ru.md) |
| 0.1.9-beta.2 | [EN](../RELEASE_0.1.9-beta.2.md) | [RU](../RELEASE_0.1.9-beta.2.ru.md) |
| 0.1.9-beta.1 | [EN](../RELEASE_0.1.9-beta.1.md) | [RU](../RELEASE_0.1.9-beta.1.ru.md) |
