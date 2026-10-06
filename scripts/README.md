[English](README.md) | [Русский](README.ru.md)

# Project utilities

Public commands are defined by [package.json](../package.json) and run through pnpm from the root.

| Directory   | Files                                                | Responsibility                                                                |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `workspace` | `setup.mjs`                                          | Creates private `.env` once                                                   |
| `workspace` | `build.mjs`, `run.mjs`                               | Ordered package/application builds using the current pnpm CLI                 |
| `workspace` | `dev.mjs`                                            | Builds server packages, starts API/Web/Admin and stops only its own processes |
| `quality`   | `check-docs.mjs`                                     | Checks local Markdown links, excluding dependencies/generated files           |
| `windows`   | [Start AnimeSoul.bat](windows/Start%20AnimeSoul.bat) | Windows setup/dev wrapper; changes to the root itself                         |

Keep maintained utilities here. Temporary reports, screenshots and local exports belong in ignored
`artifacts`; documentation belongs in `docs`. See [local development](../docs/operations/LOCAL_DEVELOPMENT.md).
