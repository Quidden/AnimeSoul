[English](STYLES.md) | [Русский](STYLES.ru.md)

# Styles and visual ownership

The React client uses global CSS, not CSS Modules/CSS-in-JS. The only TypeScript import entry is `main.tsx → globals.css`. Import order is part of the visual contract.

## Exact cascade

```text
globals.css
 ├─ styles/base.css
 │   ├─ base-core.css
 │   ├─ base-home-dashboard.css
 │   ├─ base-navigation.css
 │   ├─ base-guides.css
 │   ├─ base-catalog.css
 │   ├─ base-settings-base.css
 │   ├─ base-settings-modal.css
 │   ├─ base-personalization.css
 │   ├─ base-collections.css
 │   ├─ base-feedback.css
 │   ├─ base-cloud.css
 │   ├─ base-branding.css
 │   ├─ base-settings-center.css
 │   └─ downloads.css
 ├─ library.css
 ├─ player.css
 ├─ system-panels.css
 ├─ home-redesign.css
 ├─ ratings.css
 ├─ player-toolbar.css
 ├─ custom-player.css
 ├─ mobile-android.css
 ├─ home-library.css
 └─ header-layout.css
```

`base.css` is an imports-only manifest. At equal specificity later imports win. A feature can have an early base selector and later refinement; search the entire chain before changing an override.

## Tokens and runtime values

| Token | Default / owner |
| --- | --- |
| --bg | #09080d; theme background |
| --panel | #141218; CSS panel default |
| --line | #2c2732; borders |
| --ink | #f5f1fa; primary text |
| --muted | #9a94a2; secondary text |
| --accent | #9a78ff; theme accent |
| --accent-soft | Runtime accent + `33` alpha |
| --watched-episode-color | playerPrefs.watchedEpisodeColor |
| --interface-font-scale / --heading-font-scale | playerPrefs text/heading scales; fallback 1 |
| --poster-scale / --preview-scale | playerPrefs poster/preview scales; fallback 1 |

`useProfileStorage` applies theme colors, body background, html dataset colorScheme and native colorScheme. Light-mode overrides use `html[data-color-scheme="light"]`; some historical colors remain literal and need explicit light variants. Presets/custom colors are in settings and AppearanceSettings.

Desktop `run.py::DESKTOP_ZOOM_SCRIPT` separately sets documentElement.style.zoom, using localStorage `animesoul.desktop.interfaceScale`; Ctrl+wheel changes 0.5–2.0 in 0.1 steps, Ctrl+0 resets. This is device-local and compounds with portable CSS scales.

## Owners

| Stylesheet | UI / selector scope |
| --- | --- |
| base-core | Tokens, reset, app shell, cards/buttons/modals; .app/.anime-card/.cards/.hero/.modal |
| base-home-dashboard | Dashboard and progress primitives; .hero-widgets/.hero-box/.mini-list/.wide-progress |
| base-navigation | Search/suggestions/filter controls, folder navigation and broad responsive layout |
| base-guides | Guides, auxiliary catalogue/watch panels and historical refinements |
| base-catalog | Catalogue/filter/card layouts, format/random controls, light corrections |
| base-settings-base / base-settings-modal | Settings groups/toggles/themes; overlay/header/scroll/responsive |
| base-personalization | Watched color and CSS-driven text/poster/preview sizes |
| base-collections | Full collection overlays, favorite/folder/tracking actions |
| base-feedback | Save/API/cloud/party indicators and status popovers |
| base-cloud | OAuth, cloud card and synchronization choices |
| base-branding | AnimeSoul mark and release/rewatch badges |
| base-settings-center | Settings tabs/search/workspace layout |
| downloads | Offline library, queue and download settings |
| library | History/tracking/statistics/calendar/collapse transitions |
| player | Watch layout, iframe, seasons, previews, party |
| system-panels | Debug and changelog overlays |
| home-redesign | Cinematic hero and home composition |
| ratings | Ratings page/tree/table/picker |
| player-toolbar | Final toolbar/download controls |
| custom-player | Built-in HLS controls, menus, subtitles and states |
| mobile-android | Android safe areas, PiP and platform overrides |
| home-library | Unified library cards/tabs, poster mask and mobile composition |
| header-layout | Final header/search/navigation/status grid and responsive overrides |

## Responsive and dynamic surfaces

Breakpoints are local to files, not a global registry: commonly 550/600/640, 700/720/760/800, 860/900, 980/1000/1050/1100, 1200/1250/1350 px. Player uses hover:none and reduced-motion handling; home uses 100svh; settings have 860/760/600 arrangements. Desktop minimum window is 960×640, while browser width can be smaller.

Inline values are appropriate for runtime progress widths, positioning/previews, user colors/scales and media aspect/layout values. Launcher HTML, OAuth callback HTML and injected desktop zoom have independent inline styles outside the React bundle. Do not assume changing globals.css changes these surfaces.

## Editing workflow

Find the owner, then `rg` the selector across styles, check specificity/import order, and add light/focus/touch/responsive states. Keep selectors out of base.css. Avoid appending another override file merely to win the cascade. `npm run audit:css` checks exact duplicate declarations/selectors; it cannot prove visual equivalence. Bundle audit constrains CSS size.

Verify dark/light, 1440/960/600 widths, touch hover behavior, reduced motion, modal scrolling, Android safe areas/mini-player and desktop zoom at 50/100/200%. Preserve the player and modal lifecycle while adjusting layout. [UI guide](UI.md), [screenshots](SCREENSHOTS.md).
