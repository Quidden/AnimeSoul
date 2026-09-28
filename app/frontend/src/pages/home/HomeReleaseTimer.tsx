import { useEffect, useState } from "react";
import { fetchAnimeDetails, fetchReleaseSchedule } from "../../features/catalog/api";
import { NextEpisodeCountdown, type ReleaseScheduleRow } from "../../features/player/ReleaseSchedule";
import { fetchAnimeMetadata, type AnimeMetadata } from "../../features/player/useAnimeMetadata";
import { upcomingRelease } from "../../features/player/upcomingRelease";
import { fetchFamily } from "../../lib/anime";
import type { Anime } from "../../lib/types";

export function HomeReleaseTimer({ anime }: { anime: Anime }) {
  const [data, setData] = useState<{ animeId: number; metadata?: AnimeMetadata; rows: ReleaseScheduleRow[] }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      // Home can have only a saved title or a grouped franchise card. Obtain
      // the real entry before reading its remote IDs and related seasons.
      const detail = await fetchAnimeDetails([anime.anime_id]).then(entries => entries[0] ?? anime).catch(() => anime);
      if (controller.signal.aborted) return;
      const [metadata, family, schedule] = await Promise.allSettled([
        fetchAnimeMetadata(Number(detail.remote_ids?.shikimori_id)),
        fetchFamily(detail, undefined, controller.signal),
        fetchReleaseSchedule(),
      ]);
      if (controller.signal.aborted) return;
      const entries = family.status === "fulfilled" && family.value.length ? family.value : [detail];
      const rows = schedule.status === "fulfilled" ? entries.flatMap(entry => schedule.value
        .filter(item => item.anime_id === entry.anime_id)
        .map(item => ({ entry, item, group: { number: 1, entries: [entry] } }))) : [];
      setData({ animeId: anime.anime_id, metadata: metadata.status === "fulfilled" ? metadata.value : undefined, rows });
    };
    void load();
    return () => controller.abort();
  }, [anime.anime_id]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const release = data?.animeId === anime.anime_id ? upcomingRelease(anime.anime_id, data.metadata, data.rows, now / 1000) : undefined;
  if (!release) return null;
  const { timestamp } = release;
  const date = new Date(timestamp * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return <aside className="home-release-timer" aria-label={`Следующий выход: ${release.title ?? anime.title}, ${date}`} title={`${release.title ?? anime.title} · ${date}`}>
    <span className="home-release-timer-label">До следующего выхода</span>
    <NextEpisodeCountdown timestamp={timestamp} />
  </aside>;
}
