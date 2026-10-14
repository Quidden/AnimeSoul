import { resumeEpisodeHref, type Anime, type Episode, type Library } from "@animesoul/contracts";

export type HomeProgress = Library["progress"][number];

// The API returns newest progress first. Deduplicate before filtering out
// completed episodes so an older partial episode cannot replace the latest.
export function recentHomeProgress(progress: HomeProgress[]) {
  const latest = new Map<string, HomeProgress>();
  for (const item of progress) {
    if (
      !latest.has(item.animeId) &&
      (item.position > 0 || item.completed || item.watchedSeconds > 0)
    )
      latest.set(item.animeId, item);
  }
  return [...latest.values()].slice(0, 6);
}

export function nextHomeEpisode(progress: HomeProgress, episodes: Episode[]) {
  if (!progress.completed || !progress.episode?.id) return undefined;
  const sequence = [...episodes].sort(
    (a, b) =>
      a.season.localeCompare(b.season, "ru", { numeric: true }) ||
      a.number.localeCompare(b.number, "ru", { numeric: true }),
  );
  const index = sequence.findIndex((episode) => episode.id === progress.episode?.id);
  return index < 0 ? undefined : sequence[index + 1];
}

export function homeResumeHref(
  anime: Pick<Anime, "slug">,
  progress?: HomeProgress,
  next?: Episode,
) {
  const episodeId = next?.id ?? (progress?.completed ? undefined : progress?.episode?.id);
  return episodeId ? resumeEpisodeHref(anime.slug, episodeId) : `/anime/${anime.slug}`;
}

export function homeProgressLabel(progress: HomeProgress) {
  const episode = progress.episode
    ? `Сезон ${progress.episode.season} · Серия ${progress.episode.number}`
    : "Последний просмотр";
  const remaining = Math.max(0, progress.duration - progress.position);
  const time = progress.completed
    ? "Серия просмотрена"
    : progress.duration > 0
      ? `Осталось ${Math.max(1, Math.ceil(remaining / 60))} мин`
      : `${Math.floor(progress.position / 60)} мин просмотрено`;
  const percent = progress.completed
    ? 100
    : progress.duration > 0
      ? Math.max(0, Math.min(100, (progress.position / progress.duration) * 100))
      : 0;
  return { episode, time, percent };
}
