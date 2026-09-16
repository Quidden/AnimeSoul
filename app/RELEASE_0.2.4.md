[English](RELEASE_0.2.4.md) | [Русский](RELEASE_0.2.4.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.4

Faster downloaded-title startup, mobile player fixes and credential validation before saving.

## Local playback and performance

- Downloaded title/file has first priority without waiting for remote catalogue/providers.
- Watch screen blocks less on slow requests, reuses in-flight work and cancels stale loading.
- Local watching immediately updates home resume.
- Fixed complete dubs incorrectly flagged as shortened.

## Player and interface

- Removed overlap among local-file/loading indicators and controls; green local indicator hides with player UI.
- Changing episode from fullscreen automatically returns to fullscreen.
- Fullscreen scaling controls are easier to tap on phones.
- Optional compact episode layout retaining progress, ratings, watched marks and season selection.
- Scrollable settings sections can collapse to avoid interfering with main scrolling.

## Sources and credentials

- Detailed failed-source/data lists for loading errors.
- Separate validation for Yummy, Kodik Public/Private and Google OAuth Client ID/Secret before save.
- Each field shows working/invalid/unconfirmed status with reason; invalid/unconfirmed input never replaces working keys.
- Import all keys from JSON/TXT with examples and format guidance; imported values use the same validation.
- Fixed OAuth editing: removed Client ID does not reappear and entered Client Secret does not vanish.

## Compatibility and files

Windows retains AppId/in-place update. Profile/progress/offline format is compatible with 0.2.3. Android ARM64/7.0+ uses the previous release signing key.

- AnimeSoul-Setup-0.2.4.exe — Windows x64.
- AnimeSoul-0.2.4-android-arm64.apk — Android ARM64.

Credential checks require internet. An unavailable service yields Unconfirmed and does not replace a working value.
