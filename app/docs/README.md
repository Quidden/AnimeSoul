[English](README.md) | [Русский](README.ru.md)

# AnimeSoul documentation

Maintained `app/` implementation, version **0.2.8**, schema **3**. Reviewed against source on **2026-09-24**. English is primary; Russian counterparts use `.ru.md`. Text paths are repository-relative unless stated otherwise.

## Reading map

| Document | English | Русский |
| --- | --- | --- |
| Installation, development and checks | [EN](../README.md) | [RU](../README.ru.md) |
| Architecture and boundaries | [EN](../ARCHITECTURE.md) | [RU](../ARCHITECTURE.ru.md) |
| Technical overview and invariants | [EN](TECHNICAL_DOCUMENTATION.md) | [RU](TECHNICAL_DOCUMENTATION.ru.md) |
| UI components, navigation, state, events and native bridges | [EN](UI.md) | [RU](UI.ru.md) |
| Backend services, lifecycle, concurrency and failures | [EN](BACKEND.md) | [RU](BACKEND.ru.md) |
| HTTP/WS requests, responses, callers, errors and examples | [EN](API_REFERENCE.md) | [RU](API_REFERENCE.ru.md) |
| Generated complete route/handler and request-model inventory | [EN](API_SCHEMA.md) | [RU](API_SCHEMA.ru.md) |
| Entry points and end-to-end function calls | [EN](ENTRY_POINTS_AND_FLOWS.md) | [RU](ENTRY_POINTS_AND_FLOWS.ru.md) |
| Files and feature ownership | [EN](PROJECT_MAP.md) | [RU](PROJECT_MAP.ru.md) |
| Schema, field revisions, device files and migrations | [EN](DATA_MODEL.md) | [RU](DATA_MODEL.ru.md) |
| OAuth, sync modes, conflict policy and recovery | [EN](GDRIVE_SYNC.md) | [RU](GDRIVE_SYNC.ru.md) |
| Local devices, save sync, video transfer and remote control | [EN](LAN_DEVICES.md) | [RU](LAN_DEVICES.ru.md) |
| CSS order, tokens, owners and responsive behavior | [EN](STYLES.md) | [RU](STYLES.ru.md) |
| Windows/Android builds, native capabilities and verification | [EN](PLATFORMS.md) | [RU](PLATFORMS.ru.md) |
| Profile export/import, legacy transfer and backup | [EN](../SAVE_COMPATIBILITY.md) | [RU](../SAVE_COMPATIBILITY.ru.md) |
| Android runtime, background downloads and Cast | [EN](../mobile/README.md) | [RU](../mobile/README.ru.md) |
| Permanent Android release signing and in-place updates | [EN](../mobile/UPDATE_SIGNING.md) | [RU](../mobile/UPDATE_SIGNING.ru.md) |
| UI gallery and screenshot provenance | [EN](SCREENSHOTS.md) | [RU](SCREENSHOTS.ru.md) |
| Existing boundaries and safe future refactoring slices | [EN](REFACTORING_RECOMMENDATIONS.md) | [RU](REFACTORING_RECOMMENDATIONS.ru.md) |

## Keeping documentation current

From `app/`, `python tools/check_docs.py` checks language pairs, local links and route-inventory freshness. After an API change run `python tools/check_docs.py --write-api`, then update narrative contracts and both languages. Generated models do not replace documentation of dynamic JSON responses.

Release notes also have English/Russian pairs and describe historical behavior. The legacy-old-stack archive does not describe the maintained implementation. The application UI is predominantly Russian; bilingual documentation does not imply UI localization.

## Release history

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
