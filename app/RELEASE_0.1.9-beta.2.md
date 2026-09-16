[English](RELEASE_0.1.9-beta.2.md) | [Русский](RELEASE_0.1.9-beta.2.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.1.9 Beta 2

This beta introduces a complete Windows installation of the Python + React application.

## Windows installer

- AnimeSoul-Setup-0.1.9-beta.2.exe installs a standalone build; users need no Python, Node.js or BAT files.
- Desktop and Start menu shortcuts open a launcher with browser/desktop choices.
- The launcher edits the port and personal YummyAnime Public token, checking the token with a small real API request before saving.
- Configuration, library and progress are in `%LOCALAPPDATA%\AnimeSoul` and remain across updates.

No shared API key is included. First launch needs a personal Public token from the [YummyAnime API documentation](https://api.yani.tv/swagger); the private token is not used. Thanks to the YummyAnime developers for the API that made AnimeSoul possible.
