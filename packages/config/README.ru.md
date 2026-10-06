[English](README.md) | [Русский](README.ru.md)

# Общие настройки разработки

Эта папка не является отдельным исполняемым package; приложения и корневые команды
ссылаются на конфигурации напрямую.

| Файл                 | Кто использует                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| `tsconfig.base.json` | Все TS-проекты: strict, общие проверки и целевой JavaScript                  |
| `tsconfig.node.json` | Серверные пакеты/API: NodeNext и emit; расширяет base                        |
| `eslint.config.mjs`  | Корневой `pnpm lint` через `--config`; исключает зависимости и generated-код |
| `prettier.json`      | Prettier через поле `prettier` в корневом `package.json`                     |

`.prettierignore`, `.editorconfig` и Git/ignore-файлы остаются в корне для обычного обнаружения инструментами.
`.vscode/settings.json` указывает общий ESLint-конфиг; в другом IDE при необходимости выбирается тот же файл.
Версии инструментов закреплены в корневом package/lockfile, отдельные установки здесь не нужны.
[Карта проекта](../../docs/architecture/PROJECT_MAP.ru.md) · [Команды](../../docs/operations/LOCAL_DEVELOPMENT.ru.md).
