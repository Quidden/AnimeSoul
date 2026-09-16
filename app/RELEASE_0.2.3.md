[English](RELEASE_0.2.3.md) | [Русский](RELEASE_0.2.3.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.3

First shared Windows/Android release, updating the UI, player, offline library, Drive and diagnostics with a complete mobile build.

## Highlights

- Android edge-to-edge interface, bottom navigation, Picture-in-Picture and system playback controls.
- New Android downloads become one MP4 in Movies/AnimeSoul; known opening/ending timestamps remain available offline.
- Background download notification; mobile data blocked by default and network changes pause downloads.
- Free space and title/season/episode sizes in the offline library.
- Searchable settings with release history and detailed debug log including functions/source files.

## Player

- Fixed wrong episode selection on dub change; local playback starts before remote season loading.
- Phone screen stays awake while watching.
- First fullscreen touch reveals controls without pausing; controls auto-hide.
- Fullscreen uses available space and respects Android system bars.
- Fullscreen settings, double-tap seek and press-and-hold temporary speed-up.
- Mobile home shows a poster instead of an empty player when no trailer exists.

## Interface

- Lightweight floating search header hides while reading.
- Mobile home/catalogue/settings/download library layouts.
- Catalogue filters no longer stick to search or receive an extra backdrop.
- New episodes visually separate from the selected title; ratings sit below the player.
- Downloaded titles use horizontal poster/gradient rows with detailed information.

## Sync and reliability

- Drive selects latest actual phone/computer progress instead of restoring stale resume.
- Empty/corrupt saves do not replace a working profile.
- Expanded API/cloud/player/local diagnostics.
- Fixed overlapping settings tabs, covered buttons and disappearing bottom navigation.
- Android includes required FFmpegKit runtime dependencies for MP4 assembly.

## Compatibility and files

Windows keeps its AppId and updates the previous installation. Profiles/progress remain compatible with 0.2.2. Android requires ARM64/Android 7.0+; future updates must use the same release channel/signing key.

- AnimeSoul-Setup-0.2.3.exe — Windows x64 installer.
- AnimeSoul-0.2.3-android-arm64.apk — Android ARM64.

Catalogue/trailers need your Yummy Public token; player/downloads need the Kodik Public/Private pair stored only on the user's device.
