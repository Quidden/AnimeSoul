import type { Episode } from "@animesoul/contracts";
import type { HomeProgress } from "./home-viewing";

export type StripState = "seen" | "current" | "next" | "open" | "upcoming";
export type StripSegment = {
  number: number;
  state: StripState;
  percent: number;
  episodeId?: string;
};

// Longer seasons would turn the strip into noise; the card falls back to its progress line.
export const stripLimit = 60;

const order = (a: Episode, b: Episode) => a.number.localeCompare(b.number, "ru", { numeric: true });

// One segment per episode of the season being watched. Released episodes link to the
// player; the announced remainder of the season is drawn as upcoming segments.
export function episodeStrip(
  latest: HomeProgress,
  progress: HomeProgress[],
  episodes: Episode[],
  total?: number,
): StripSegment[] {
  const season = latest.episode?.season;
  if (!season) return [];
  const released = episodes.filter((episode) => episode.season === season).sort(order);
  // Specials (season 0) are not part of the announced episode count.
  const count = season === "0" ? released.length : Math.max(released.length, total ?? 0);
  if (!released.length || count > stripLimit) return [];
  const watched = new Map<string, HomeProgress>();
  for (const item of progress)
    if (item.animeId === latest.animeId && item.episode?.id && !watched.has(item.episode.id))
      watched.set(item.episode.id, item);
  const latestIndex = released.findIndex((episode) => episode.id === latest.episode?.id);
  const currentIndex = latest.completed ? latestIndex + 1 : latestIndex;
  const segments: StripSegment[] = released.map((episode, index) => {
    const saved = watched.get(episode.id);
    const number = Number.parseInt(episode.number, 10) || index + 1;
    if (index === currentIndex && !saved?.completed)
      return {
        number,
        state: latest.completed ? "next" : "current",
        percent:
          !latest.completed && latest.duration > 0
            ? Math.min(100, Math.max(0, (latest.position / latest.duration) * 100))
            : 0,
        episodeId: episode.id,
      };
    return {
      number,
      state: saved?.completed ? "seen" : "open",
      percent: saved?.completed ? 100 : 0,
      episodeId: episode.id,
    };
  });
  const last = segments.at(-1)?.number ?? 0;
  for (let index = released.length; index < count; index++)
    segments.push({ number: last + index - released.length + 1, state: "upcoming", percent: 0 });
  return segments;
}

export function stripLabel(segment: StripSegment) {
  const name = `Серия ${segment.number}`;
  switch (segment.state) {
    case "seen":
      return `${name} · просмотрена`;
    case "current":
      return `${name} · ${Math.round(segment.percent)}%`;
    case "next":
      return `${name} · следующая`;
    case "upcoming":
      return `${name} · ещё не вышла`;
    default:
      return name;
  }
}
