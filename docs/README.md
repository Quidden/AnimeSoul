[English](README.md) | [Русский](README.ru.md)

# AnimeSoul documentation

Maintained `app/` implementation, version **0.3.0**, schema **3**. Reviewed against source on **2026-09-26**. English is primary; Russian counterparts use `.ru.md`. Text paths are repository-relative unless stated otherwise.

## Reading map

| Document | English | Русский |
| --- | --- | --- |
| Installation, development and checks | [EN](DEVELOPMENT.md) | [RU](DEVELOPMENT.ru.md) |
| Website accounts, PostgreSQL, roles and deployment | [EN](deployment/WEBSITE.md) | [RU](deployment/WEBSITE.ru.md) |
| Architecture and boundaries | [EN](architecture/ARCHITECTURE.md) | [RU](architecture/ARCHITECTURE.ru.md) |
| Migration roadmap: stack, mobile, SEO, security, administration and payments | [EN](architecture/WEB_STACK_PLAN.md) | [RU](architecture/WEB_STACK_PLAN.ru.md) |
| Technical overview and invariants | [EN](architecture/TECHNICAL_DOCUMENTATION.md) | [RU](architecture/TECHNICAL_DOCUMENTATION.ru.md) |
| UI components, navigation, state, events and native bridges | [EN](frontend/UI.md) | [RU](frontend/UI.ru.md) |
| Backend services, lifecycle, concurrency and failures | [EN](architecture/BACKEND.md) | [RU](architecture/BACKEND.ru.md) |
| HTTP/WS requests, responses, callers, errors and examples | [EN](api/API_REFERENCE.md) | [RU](api/API_REFERENCE.ru.md) |
| Generated complete route/handler and request-model inventory | [EN](api/API_SCHEMA.md) | [RU](api/API_SCHEMA.ru.md) |
| Entry points and end-to-end function calls | [EN](architecture/ENTRY_POINTS_AND_FLOWS.md) | [RU](architecture/ENTRY_POINTS_AND_FLOWS.ru.md) |
| Files and feature ownership | [EN](architecture/PROJECT_MAP.md) | [RU](architecture/PROJECT_MAP.ru.md) |
| Schema, field revisions, device files and migrations | [EN](architecture/DATA_MODEL.md) | [RU](architecture/DATA_MODEL.ru.md) |
| OAuth, sync modes, conflict policy and recovery | [EN](guides/GDRIVE_SYNC.md) | [RU](guides/GDRIVE_SYNC.ru.md) |
| Local devices, save sync, video transfer and remote control | [EN](guides/LAN_DEVICES.md) | [RU](guides/LAN_DEVICES.ru.md) |
| CSS order, tokens, owners and responsive behavior | [EN](frontend/STYLES.md) | [RU](frontend/STYLES.ru.md) |
| Windows/Android builds, native capabilities and verification | [EN](platforms/PLATFORMS.md) | [RU](platforms/PLATFORMS.ru.md) |
| Profile export/import, legacy transfer and backup | [EN](guides/SAVE_COMPATIBILITY.md) | [RU](guides/SAVE_COMPATIBILITY.ru.md) |
| Android runtime, background downloads and Cast | [EN](platforms/ANDROID.md) | [RU](platforms/ANDROID.ru.md) |
| Permanent Android release signing and in-place updates | [EN](platforms/ANDROID_UPDATE_SIGNING.md) | [RU](platforms/ANDROID_UPDATE_SIGNING.ru.md) |
| UI gallery and screenshot provenance | [EN](screenshots/SCREENSHOTS.md) | [RU](screenshots/SCREENSHOTS.ru.md) |
| Existing boundaries and safe future refactoring slices | [EN](architecture/REFACTORING_RECOMMENDATIONS.md) | [RU](architecture/REFACTORING_RECOMMENDATIONS.ru.md) |

## Keeping documentation current

Documentation was reorganized on **2026-10-06**. Keep maintained guides under `docs/`, release notes under `docs/releases/`, and design references under `docs/design/`. Generated output belongs in the ignored `artifacts/` directory; archived implementation belongs in `archive/legacy-old-stack/`. The migration plan defines the future clean main branch, separate mobile repository and transition gates; migration and the YummyAnime switch have not started.

From `app/`, `python tools/check_docs.py` checks language pairs, local links and route-inventory freshness. After an API change run `python tools/check_docs.py --write-api`, then update narrative contracts and both languages. Generated models do not replace documentation of dynamic JSON responses.

Release notes also have English/Russian pairs and describe historical behavior. The legacy-old-stack archive does not describe the maintained implementation. The application UI is predominantly Russian; bilingual documentation does not imply UI localization.

## Release history

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
