import type { AnimeMetadata } from "./useAnimeMetadata";
import { NextEpisodeCountdown, type ReleaseScheduleRow } from "./ReleaseSchedule";
import { upcomingRelease } from "./upcomingRelease";

export function ReleaseHighlight({ animeId, metadata, rows }: {
  animeId: number;
  metadata?: AnimeMetadata;
  rows: ReleaseScheduleRow[];
}) {
  const release = upcomingRelease(animeId, metadata, rows);
  if (!release) return null;
  const { timestamp } = release;
  return <section className="release-highlight" aria-label="До выхода следующей серии">
    <div className="release-highlight-heading"><span>Следующий выход</span><time dateTime={new Date(timestamp * 1000).toISOString()}>{new Date(timestamp * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</time></div>
    {release.animeId !== animeId && <small className="release-highlight-title">{release.title}</small>}
    <NextEpisodeCountdown timestamp={timestamp} />
  </section>;
}
