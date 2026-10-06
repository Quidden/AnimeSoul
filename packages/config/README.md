[English](README.md) | [Русский](README.ru.md)

# Shared development configuration

This directory is not an executable workspace package. Applications and root commands reference files directly.

| File                 | Consumer                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `tsconfig.base.json` | Every TS project: strictness, shared checks and JavaScript target      |
| `tsconfig.node.json` | Server packages/API: NodeNext and emit; extends base                   |
| `eslint.config.mjs`  | Root `pnpm lint` with `--config`; excludes dependencies/generated code |
| `prettier.json`      | Prettier through the root `package.json` `prettier` field              |

`.prettierignore`, `.editorconfig` and Git/ignore files stay at the root for normal tool discovery.
`.vscode/settings.json` points ESLint to the shared file; configure the equivalent path in another IDE if needed.
Tool versions belong to the root package/lockfile; no separate installation is needed here.
[Project map](../../docs/architecture/PROJECT_MAP.md) · [Commands](../../docs/operations/LOCAL_DEVELOPMENT.md).
