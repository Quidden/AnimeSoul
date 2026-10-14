import type { GlobalSearchResponse } from "@animesoul/contracts";
import { searchWatchView } from "../lib/search-watch";

type SearchAnime = GlobalSearchResponse["anime"][number];

export function SearchAnimeProgress({ anime }: { anime: SearchAnime }) {
  const view = searchWatchView(anime);
  return (
    <span className="search-anime-progress" data-watch-status={view.watch?.status}>
      <span className="search-watch-meta">
        <span className="search-episode-count">{view.episodeLabel}</span>
        {view.watch && (
          <span className="search-watch-state" title={view.watch.detail || undefined}>
            {view.watch.label}
          </span>
        )}
      </span>
      {view.watch && view.watch.percent !== null && (
        <progress
          value={view.watch.percent}
          max={100}
          aria-label={`${view.watch.progressLabel}: ${anime.title}`}
          aria-valuetext={`${view.watch.label}${view.watch.detail ? `. ${view.watch.detail}` : ""}`}
          title={view.watch.detail || view.watch.label}
        />
      )}
    </span>
  );
}
