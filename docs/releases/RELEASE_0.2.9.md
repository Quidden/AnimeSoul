[English](RELEASE_0.2.9.md) | [Русский](RELEASE_0.2.9.ru.md)

# AnimeSoul 0.2.9

Release date: **September 28, 2026**.

## Catalogue and recommendations

- The unfiltered catalogue shows horizontal collections with **Popular now** first. Collection titles and “View all” open their full filtered pages; arrows and touch gestures browse each row.
- Fixed filter layout and removed the redundant YummyAnime catalogue heading. Desktop filters stay in a left sidebar and stick below the header while scrolling; on phones, a fixed button opens the filter panel.
- Removed the bottom “Show more” button from the collection view and kept pagination for full filtered results. Collection rows no longer show scrollbars or trap vertical page scrolling.
- Ongoing titles load beyond the initial catalogue page, preventing an incomplete collection with just one anime.
- Experimental recommendations use the watched-genre statistics to suggest a list or randomly pick an unseen anime. A preferred genre can refine the selection. Genre weights represent viewing preferences, not how strongly a genre appears in a title.

## Home screen

- A compact countdown below “Continue” shows the next announced episode or season for the last watched franchise, using the same date selection as the anime page.
- Cards in “Watching now” have a small close icon without a circular border. Removing a card preserves viewing progress; watching the title again returns it to the list.

## Anime pages and navigation

- The anime page now combines franchise trailers, ratings, metadata, descriptions and a viewing-order map in one responsive layout.
- Direct routes restore an anime, episode, catalogue filter, tracking page, collection or history view after navigation and restart.
- The release schedule is collapsible and shows announced upcoming episodes without listing episodes that already aired.

## Tracking and playback

- The tracking calendar uses one continuous six-week grid with neighbouring dates, wheel/touch navigation and a visible month transition.
- Episode dates and calendar events are shown from a persistent local cache first, then refreshed from the API without clearing the screen.
- AnimeSoulPlayer adds Anime4K upscaling controls, more reliable episode/dubbing selection and improved timeline previews.
- Ambient artwork, trailer lighting and the updated header can be controlled from appearance settings.

## Reliability

- A running backend from another release is no longer reused; WebView launches bypass stale HTML caches.
- Google Drive initial synchronization keeps the user's explicit choice and offers a safe retry after a failed merge.
- LAN remote control validates volume commands and exposes a clearer phone/remote playback flow.

The profile schema remains **3** and is compatible with 0.2.8. Cached release dates are disposable and do not contain progress or settings.

## Release file

- `AnimeSoul-Setup-0.2.9.exe` — Windows x64 installer.

The new Android version is still in development and is not included in this release. No 0.2.9 APK is published.
