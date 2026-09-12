import { useEffect, useState } from "react";
import type { Anime, SeasonGroup, Video } from "../../lib/types";
import { animeMyAnimeListId, fetchEpisodeAirDates, type EpisodeAirDates } from "../../lib/episodeDates";

export function useEpisodeAirDates(
  seasons: SeasonGroup[],
  seasonVideos: Record<number, Video[]>,
  detailedEntries: Record<number, Anime>,
  collapsedSeasons: number[],
) {
  const [dates, setDates] = useState<Record<number, EpisodeAirDates>>({});
  const requestedIds = new Set<number>();
  for (const group of seasons) {
    if (collapsedSeasons.includes(group.number)) continue;
    for (const video of seasonVideos[group.number] ?? []) {
      const entry = group.entries.find(item => item.anime_id === video.originAnimeId) ?? group.entries[0];
      if (!entry) continue;
      const id = animeMyAnimeListId(detailedEntries[entry.anime_id] ?? entry) ?? animeMyAnimeListId(entry);
      if (id) requestedIds.add(id);
    }
  }
  const requestKey = [...requestedIds].sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    const refresh = () => {
      for (const id of requestKey.split(",").map(Number)) {
        void fetchEpisodeAirDates(id).then(result => {
          if (!cancelled) setDates(current => current[id] === result ? current : { ...current, [id]: result });
        });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [requestKey]);
  return dates;
}
