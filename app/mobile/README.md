[English](README.md) | [Русский](README.ru.md)

# AnimeSoul for Android

[Platforms](../docs/PLATFORMS.md) · [Permanent update signing](UPDATE_SIGNING.md) · [API](../docs/API_REFERENCE.md)

Android packages AnimeSoul 0.2.7's React interface, FastAPI backend and Python runtime in one ARM64 app. Catalogue, profiles, progress, ratings, statistics, Drive, direct player and offline library use the desktop contracts. Watch Party is deliberately omitted from both UI and backend routes.

## Navigation and playback

Bottom navigation respects Android safe areas. Home uses shared library tabs/cards and expands lists by 10. Leaving full watch view keeps the same player in a draggable floating panel above navigation; center reopens it, × clears the active session. Native Picture-in-Picture is a separate mode used when leaving the app. MediaSession integrates system playback controls.

## Offline media

HLS is remuxed by bundled FFmpegKit to one seekable MP4 without re-encoding and published through MediaStore to `Movies/AnimeSoul/<title>/<season>`. Private index, posters, keys and settings stay in the app sandbox. After reinstall/index loss, grant video access and scan downloaded files to recover title/season/episode/dub/quality/size/media reference from folders and filenames.

Selection supports multiple seasons, from/to ranges and individual episodes. New selections become separate jobs in a sequential queue while earlier work continues. The library supports per-episode, season and whole-title deletion. Direct playback/downloads require the user's Kodik Public/Private pair via the Keys settings; Offline settings handle download behavior/location.

## Background jobs

Enqueue starts a dataSync foreground service. It polls local FastAPI independently of WebView timers, displays progress and holds a scoped PARTIAL_WAKE_LOCK while jobs remain active. Android 13+ asks for notification permission; denied permission may hide ordinary notification while the OS still exposes the active foreground service.

Mobile-data downloads are disabled by default. Switching away from an allowed network can pause the active episode and update the notification; permitted connectivity resumes it. The Python queue is memory-only: force-stop, reboot or process termination loses queued work. Persistent WorkManager/DownloadManager ownership is not implemented.

## Experimental Google Cast

From AnimeSoulPlayer, choose the TV/device button. Phone and receiver must share a LAN and the TV must support Google Cast/Chromecast. Google Default Media Receiver handles the stream; no separate AnimeSoul TV app is required.

Handoff transfers position. Remote controls support play/pause/seek, receiver volume via device dialog and return to the phone paused. Progress/end events feed the existing episode/dub/auto-next controller. Session bar and system notification retain stop controls across navigation.

Supported: direct online HTTPS HLS/MP4. Unsupported: iframe players, offline files, transferring selected text/embedded subtitles or speed. Provider URL reachability/CORS/codecs can prevent receiver playback. FastAPI stays on loopback; private keys/settings are not exposed on the LAN. The AnimeSoulCast.postMessage bridge is restricted through AndroidX WebKit to the top local-origin page. SDK listeners are released with Activity destruction.

## Build and update

Needs JDK 17, Android SDK 35, Python 3.12 from app/.venv and the Node frontend toolchain. Gradle builds `VITE_ANIMESOUL_PLATFORM=android` into dist-android, copies backend/mobile runtime and packages dependencies with Chaquopy.

From `app/mobile/android`:

```powershell
.\gradlew.bat assembleDebug
```

Output relative to that directory: `app/build/outputs/apk/debug/app-debug.apk`. `build_android.ps1` reuses a local toolchain Gradle when present. Debug applicationId is `com.animesoul.mobile.debug`, port 19083; release is `com.animesoul.mobile`, port 19082. They can coexist without clearing release data.

Public APK: assembleRelease with the permanent key described in [signing](UPDATE_SIGNING.md), or run `./mobile/build_android.ps1 -Configuration Release` from app. The build reads a Yummy Public token from ignored app/animesoul.python.json. Google OAuth and Kodik keys are not embedded: users configure them on the phone. See [platform validation](../docs/PLATFORMS.md) for native/device checks beyond shared tests.
