[English](ASSETS.md) | [Русский](ASSETS.ru.md)

# Profile and website media

This directory is served by Next.js at `/`. Current assets are `animesoul-icon.png`
and trusted illustrations under `profile-presets/`:

| Type    | Files                                                                          |
| ------- | ------------------------------------------------------------------------------ |
| Avatars | `avatar-cat.svg`, `avatar-kitsune.svg`, `avatar-moon.svg`, `avatar-orbit.svg`  |
| Covers  | `banner-dawn.svg`, `banner-night.svg`, `banner-sakura.svg`, `banner-stars.svg` |

The illustrations were created for AnimeSoul. Animated presets respect the viewer's reduced-motion setting.
The demo profile chooses asset paths in [fixtures.ts](../../../packages/database/src/fixtures.ts);
[ProfileHeader.tsx](../components/ProfileHeader.tsx) renders the public avatar/banner values.
Presets are listed in packages/contracts/src/profile-media.ts, selected by the owner in /account and persisted through /api/account/profile. Arbitrary external URLs are rejected.

Profile owners can select presets, upload JPEG/PNG/WebP/GIF, or choose an animated GIF from the
GIPHY `anime` results. The web picker includes attribution and loads GIPHY directly from the browser
with a dedicated public web key supplied at runtime. Profiles store only GIPHY IDs; no GIPHY copies
or URLs are cached on our server. Uploaded files retain original bytes after full validation, are stored
outside `public/`, and are served subject to profile visibility. Editing always requires the owner's
session and CSRF. See [account/media operations](../../../docs/operations/ACCOUNTS.md).

The six `images/player-preview/*-full.jpg` screenshots show the actual AnimeSoul player with its
navigation, quality, speed, image, continuation and fullscreen controls. They retain the full player
frame and can be enlarged in the subscription gallery. Older `navigation.jpg` and `settings.jpg`
captures of a procedural starfield are retained as earlier assets.

The public interactive demo uses the original, locally drawn animated scene “Путь к городу” under
`media/player-demo/`: an approximately 18-second silent WebM clip in 1280×720 and 640×360,
plus a JPEG poster. Both qualities contain the same scene. The player code loads on demand;
the demo starts after a viewer clicks. No third-party footage is bundled.
See [subscriptions](../../../docs/operations/SUBSCRIPTIONS.md).

The original scene source is [generate-player-demo.html](../../../scripts/media/generate-player-demo.html).
Run `node scripts/media/generate-player-demo.mjs`, open `http://127.0.0.1:18890` in Chromium and
click “Создать фрагмент” to render both qualities and the poster. Save the three generated files
under `apps/web/public/media/player-demo/` using the same names. The local tool has no external
media or service dependencies.

Development posters reference the same public CDN URLs returned by the archived local catalog for
Frieren, Violet Evergarden and Your Name. They are preview references, not bundled artwork or a production
content license. Production metadata/media sourcing remains a separate migration gate.

See the [presentation guide](../../../docs/design/README.md), [site map](../../../docs/architecture/SITE_MAP.md)
and [security baseline](../../../docs/security/BASELINE.md).
