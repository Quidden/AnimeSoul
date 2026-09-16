[English](RELEASE_0.2.2.md) | [Русский](RELEASE_0.2.2.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.2

Built-in AnimeSoul player and a complete offline library using Kodik's private API. Focus: exact season/episode/dub identity, predictable local-video selection and one interface for online/downloaded content.

## Added

- HLS player with fixed quality, measured bitrate, speed, Picture-in-Picture and fullscreen.
- API/HLS subtitles with language selection and synchronization of separate Kodik versions with embedded subtitles.
- Opening/ending markers, manual/automatic skips, quick season/episode/dub/source controls inside the player.
- Favorite dubs, per-title preferred dub and remembered playback source.
- Episode/season/title downloads, quality selection, job progress, cancel and local-copy deletion.
- Official Kodik Public/Private credentials; private key protected with Windows DPAPI and not sent to frontend.

## Fixed

- Dub changes retain season/episode instead of selecting another Kodik release.
- Resume uses latest actual position and retains source season/episode/dub identity.
- Selected HLS quality is fixed instead of remaining hidden auto ABR; progress bar, available subtitles and language selection work.
- Seamless switching applies only to a dub change of the same episode; manual source selection loads the chosen video.
- Temporary catalogue failures retain local seasons/downloaded episodes.
- Launcher checks runtime capabilities and restarts outdated owned instances missing required API routes.

## Improved

- Downloaded video takes priority and is reselected when returning to a dub with a local copy.
- All downloaded videos use AnimeSoulPlayer and a green Local video badge.
- Watch Party uses online sources only; local copies are temporarily excluded while in a room.
- Compatible dub switching prepares new audio separately while preserving picture, position and fullscreen.
- Notice for a possibly shortened dub with substantially lower duration.
- Home resume trailer loops without YouTube playlist navigation.
- Downloads remain available in player settings when the outer side panel is hidden.
- Separate Yummy/Kodik/local/cloud diagnostics.

## Compatibility and installer

Unchanged save format/schema; 0.2.1 data and unknown profile fields remain compatible across local save/import/Drive. AnimeSoul-Setup-0.2.2.exe includes launcher/runtime/browser/desktop modes without requiring Python/Node.js.

Catalogue/trailers need your Yummy Public token. Built-in player/downloads require the complete Kodik Public/Private pair; the private key remains on the computer. Downloads stay in the selected directory and are not transmitted to Watch Party participants.
