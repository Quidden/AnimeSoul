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
There is no preset-selection catalog, owner picker or persistence endpoint yet.

The Python `profile_media.py`, embedded GIPHY picker and attribution image belong to the archive,
not this `main`. No live GIPHY search or custom upload endpoint is connected. API keys remain server-side
when that integration is implemented; do not add them to static assets or client variables.

Product policy for migration: prepared ordinary and animated avatars/covers are available to everyone;
custom uploads and external GIF search require premium or a higher server permission.
Decorative badges do not grant that permission. Provider attribution and media validation must be implemented
with the picker rather than copied as unused assets.

Development posters reference the same public CDN URLs returned by the archived local catalog for
Frieren, Violet Evergarden and Your Name. They are preview references, not bundled artwork or a production
content license. Production metadata/media sourcing remains a separate migration gate.

See the [presentation guide](../../../docs/design/README.md), [site map](../../../docs/architecture/SITE_MAP.md)
and [security baseline](../../../docs/security/BASELINE.md).
