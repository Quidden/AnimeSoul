[English](PLATFORMS.md) | [Русский](PLATFORMS.ru.md)

# Windows and Android

Version **0.2.7** shares React and FastAPI contracts across platforms. Profiles, progress, folders, history, ratings and preferences use the same data model; shell, filesystem permissions and media lifecycle differ.

| Capability | Windows browser / desktop | Android |
| --- | --- | --- |
| UI/server | Browser or PyWebView + local Python/Uvicorn | WebView + embedded Chaquopy/Python |
| Default port | Source 8000; installed launcher 3001 unless configured | Release 19082; debug 19083 |
| Watch Party | Available | UI and router disabled |
| Online player | HLS/MP4 and provider iframe fallback | Same player with native media lifecycle |
| Navigation during playback | Desktop watch behavior | Same mounted Watch becomes floating mini-player |
| PiP | Depends on browser/WebView capability | Native application Picture-in-Picture |
| Offline | Files in selected library folder | FFmpegKit remux → seekable MP4 → MediaStore |
| Cast | No Android Cast bridge | Experimental online HTTPS HLS/MP4 |
| Scaling | Profile sizes plus PyWebView Ctrl+wheel/Ctrl+0 | Responsive/safe-area layout |

Home keeps the trailer/hero above library tabs; lists expand 10 items at a time and scroll with the document. Episode cards use source release dates when known, otherwise an added-date fallback/unknown label.

## Windows build

From `app/`:

```powershell
.\packaging\build_windows.ps1
```

The script coordinates frontend preparation, PyInstaller launcher/runtime and Inno Setup. Output for this version: repository `release-work/AnimeSoul-Setup-0.2.7.exe`. Installed program: `%LOCALAPPDATA%\Programs\AnimeSoul`; config/data: `%LOCALAPPDATA%\AnimeSoul`. Read [application development commands](../README.md) for source execution.

## Android build

From `app/`:

```powershell
.\mobile\build_android.ps1 -Configuration Release
```

Requires JDK 17, SDK 35 and Python 3.12 in app/.venv, plus release signing for release builds. Gradle builds frontend with `VITE_ANIMESOUL_PLATFORM=android` into `dist-android`, copies backend/runtime and packages ARM64 through Chaquopy. The Android build does not overwrite desktop `frontend/dist`.

Output: `app/mobile/releases/AnimeSoul-0.2.7-android-arm64.apk`. Release applicationId `com.animesoul.mobile`, versionCode `2070000`. Debug uses `com.animesoul.mobile.debug` and port 19083 so it can coexist with release. Gradle direct debug command from `app/mobile/android`: `./gradlew.bat assembleDebug`; output is `app/build/outputs/apk/debug/app-debug.apk` relative to that directory.

The build reads a Yummy Public token from ignored source config. Google OAuth/Kodik secrets are entered on the device, not embedded by the build. [Android guide](../mobile/README.md), [permanent signing](../mobile/UPDATE_SIGNING.md).

## Android lifecycle and limitations

Switching sections keeps Watch mounted as a draggable panel; its center reopens full view and × clears the session. System PiP is separate and applies when leaving the app. Modal/native-back handling prevents closing two UI layers at once.

Downloads publish under `Movies/AnimeSoul/<title>/<season>`. Private index loss can be repaired by scanning permitted MediaStore videos. Mobile downloads are off by default; a network change can pause the active item. A dataSync foreground service polls Python, displays progress and holds a scoped wake lock. Notification permission is requested on Android 13+. Process kill/force-stop/reboot still loses the memory queue.

Cast uses Google Default Media Receiver on the same LAN and sends direct online HTTPS media. It does not cast iframe players, downloaded episodes, selected subtitles or playback speed. Signed URL reachability, CORS and codecs depend on the provider/receiver. Returning to the phone restores paused playback. Backend stays on loopback; native bridge is restricted to the local top page.

## Release verification

| Area | Check |
| --- | --- |
| Shared logic | Ruff, `python -m unittest discover -s backend/tests -v`, `npm run check` |
| Install/update | Windows installer; Android `adb install -r <apk>` with same signing key and increasing versionCode |
| Library | Home tabs, pagination, dark/light, narrow/wide layout |
| Playback | Real HLS, seek/timeline, dub/source changes, resume, quality/subtitles/skip |
| Android lifecycle | Back, floating player, close, background, PiP, MediaSession |
| Offline | Queue/cancel/delete, network pause, file/MediaStore playback and rescan |
| Cast | Device discovery, handoff, progress/end, stop/return, receiver failure |
| Data | Existing profiles retained, unknown fields, cloud first-choice and restore backup |

Update frontend, Windows build/installer and Android versionName together. Android versionCode must exceed published builds, with the same permanent signing key. Browser harnesses complement but do not replace real decoding/device checks.
