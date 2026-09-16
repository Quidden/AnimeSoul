[English](RELEASE_0.2.6.md) | [Русский](RELEASE_0.2.6.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.6

Android Google Cast, easier built-in player settings, reliable repeated auto-next, plus performance/refactoring work since 0.2.5.

## Experimental Google Cast / Chromecast

- Android AnimeSoulPlayer TV button opens the standard Cast picker; no separate TV app required.
- Handoff retains position; pause/seek/receiver volume via device dialog and return to phone paused.
- TV progress/end events support episode/dub changes with position preservation and auto-next.
- Local decoder stops during Cast; session controls and system notification remain after navigation.
- Bridge restricted to the trusted top AnimeSoul page; third-party iframe has no access and private backend is not exposed to LAN.

Only direct online HTTPS HLS/MP4. No downloaded files, iframe players, selected subtitle/speed transfer. Phone/receiver need the same LAN, Google Play services and a compatible Cast/Chromecast receiver. Playback depends on CORS/codecs/Kodik URL reachability from the TV.

Remote logic, mobile layout and native Android Cast dialog were checked for this release. **End-to-end Kodik playback on a real TV had not yet been tested.** Windows Cast is not included.

## Player

- Opening/ending auto-skip and auto-next in player settings, synchronized with the outer toolbar.
- Fixed repeated fullscreen auto-next using the current selection rather than stale iframe state.
- Late Cast events do not transfer previous-episode progress to the next.
- Selecting a downloaded file ends Cast and returns local playback.

## Performance and maintenance

- Lazy heavy screens and entry-JS/CSS/lazy-chunk size budgets.
- Extracted navigation/folder/download/autosave/cloud/Kodik/Android playback controllers; removed duplicate CSS/unused code.
- Cast regressions, browser remote harness and Android smoke test for native dialog/iframe bridge isolation.

## Compatibility and files

0.2.5 saves remain compatible. Windows keeps AppId. Android uses permanent release signing with increased versionCode; do not uninstall the main app before updating.

- AnimeSoul-Setup-0.2.6.exe — Windows x64.
- AnimeSoul-0.2.6-android-arm64.apk — Android ARM64, Android 7.0+.
