[English](README.md) | [Русский](README.ru.md)

# Website presentation

`main` restores the previous website style using Next.js/React: dark surfaces, glass header,
compact cards and an open profile composition. See the [route map](../architecture/SITE_MAP.md).

| Area                                       | CSS under `apps/web/styles` | Components/pages                                     |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------- |
| Colors, typography and shared elements     | `base.css`                  | `app/layout.tsx`, `components/Icon.tsx`              |
| Header, search, menu and footer            | `header.css`                | `SiteHeader.tsx`, `SiteFooter.tsx`                   |
| Home/banner                                | `home.css`                  | `app/page.tsx`                                       |
| Catalog, filters and cards                 | `catalog.css`               | `app/catalog/page.tsx`, `AnimeCard.tsx`              |
| Anime information                          | `anime.css`                 | `app/anime/[slug]/page.tsx`                          |
| Profile, fading cover and compact identity | `profile.css`               | `ProfileHeader.tsx`, `app/users/[username]/page.tsx` |

`apps/web/app/globals.css` only imports page-specific CSS.
Admin owns `apps/admin/app/globals.css` independently; its current page explains closed access.

The profile cover fills the screen width and fades near the avatar. `ProfileHeader` measures scroll,
updates `--profile-collapse` and portals compact avatar/username into body above the site header.
This changes presentation, not stored account preferences. Public content/links are server-rendered;
client JavaScript adds the menu and animation.

## Retained prototype

[minimal-concepts.html](minimal-concepts.html) is a historical standalone exploration.
Its buttons, localStorage, playback/provider labels and mobile variants are not implemented `main`
features and do not call the API. It is retained for comparison, excluded from application builds
and automatic formatting.

See the [media guide](../../apps/web/public/ASSETS.md) for trusted assets.
Change the relevant CSS/component and verify the actual application rather than the historical prototype.
Presentation changes and feature migration are separate tasks.
