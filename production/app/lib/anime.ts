import type { Anime, AnimeProgress, EpisodeState, Video } from "./types";

export function normalizeAnimeSearch(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function animeSearchTitles(anime: Anime) {
  const aliases = Array.isArray(anime.other_titles)
    ? anime.other_titles
    : typeof anime.other_titles === "string"
      ? [anime.other_titles]
      : [];
  return [anime.title, anime.original, anime.title_ru, anime.title_en, ...aliases]
    .filter((title): title is string => Boolean(title?.trim()))
    .map(normalizeAnimeSearch);
}

export function animeSearchScore(anime: Anime, query: string) {
  const normalizedQuery = normalizeAnimeSearch(query);
  if (!normalizedQuery) return 1;
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let best = 0;
  for (const title of animeSearchTitles(anime)) {
    if (title === normalizedQuery) best = Math.max(best, 1000);
    else if (title.startsWith(normalizedQuery)) best = Math.max(best, 800);
    else if (title.includes(normalizedQuery)) best = Math.max(best, 650);
    const matchedTokens = tokens.filter((token) => title.includes(token)).length;
    if (matchedTokens === tokens.length) best = Math.max(best, 400 + matchedTokens * 20);
  }
  return best;
}

export function matchesAnimeSearch(anime: Anime, query: string) {
  return animeSearchScore(anime, query) > 0;
}

export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
}
export function formatLongDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}
export function formatCalendarDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(timestamp * 1000),
  );
}
export function isLightColor(color: string) {
  const hex = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 180;
}
export function episodeDuration(videos: Video[], episode: string) {
  return videos.find((video) => video.number === episode && video.duration)?.duration ?? 0;
}
export function isMovieAnime(anime: Anime) {
  return /фильм|movie|film|полнометраж/i.test(`${anime.type?.name ?? ""} ${anime.type?.alias ?? ""}`);
}
export function isOvaAnime(anime: Anime) {
  return anime.type?.alias === "ova" || /\bova\b/i.test(`${anime.type?.name ?? ""} ${anime.title}`);
}
export function isExtraAnime(anime: Anime) {
  return (
    isOvaAnime(anime) ||
    anime.type?.alias === "ona" ||
    anime.type?.alias === "special" ||
    /спец|special|\bona\b/i.test(`${anime.type?.name ?? ""} ${anime.title}`)
  );
}
export function byViewingOrder(a: Anime, b: Anime) {
  return (a.data?.index ?? 9999) - (b.data?.index ?? 9999) || (a.year ?? 9999) - (b.year ?? 9999);
}
export function shortEntryTitle(title: string, root: string) {
  return title.replace(root, "").replace(/^[\s:|.–—-]+/, "").trim() || title;
}
export function isEpisodeWatched(state?: EpisodeState) {
  return Boolean(state?.completed || state?.percent === 100);
}
export function watchTimeProgress(progress?: AnimeProgress) {
  if (!progress) return 0;
  const watched = Object.values(progress.episodes).reduce(
    (sum, state) =>
      sum + (state.completed && state.duration ? state.duration : Math.min(state.position, state.duration || state.position)),
    0,
  );
  const durations = Object.values(progress.episodes).map((state) => state.duration).filter(Boolean);
  const average = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const total = progress.totalDuration || average * (progress.totalEpisodes ?? 0);
  return total ? Math.min(100, Math.round((watched / total) * 100)) : 0;
}
export function releaseStatus(anime: Anime) {
  const raw = `${anime.anime_status?.alias ?? ""} ${anime.anime_status?.title ?? ""}`.toLowerCase();
  if (/ongoing|airing|онгоинг|выходит/.test(raw)) return { label: "Сейчас выходит", kind: "airing" };
  if (/announce|planned|upcoming|анонс|заплан/.test(raw) || (anime.year ?? 0) > new Date().getFullYear())
    return { label: "Запланировано", kind: "planned" };
  return { label: "Вышло", kind: "released" };
}
export function durationRange(videos: Video[]) {
  const values = videos.map((video) => video.duration ?? 0).filter(Boolean);
  if (!values.length) return "Длительность неизвестна";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${formatDuration(min)} серия` : `${formatDuration(min)}–${formatDuration(max)} серия`;
}
export function reorder(items: number[], from: number, to: number) {
  if (from === to || !items.includes(from) || !items.includes(to)) return items;
  const next = [...items];
  const [item] = next.splice(next.indexOf(from), 1);
  next.splice(next.indexOf(to), 0, item);
  return next;
}
export function stripPart(title: string) {
  return title.replace(/\s*(?:\||\.|-)?\s*часть\s*\d+$/i, "").trim();
}
export function partNumber(title: string) {
  return Number(title.match(/часть\s*(\d+)$/i)?.[1] ?? 1);
}
export function franchiseName(title: string) {
  return stripPart(title)
    .split(":")[0]
    .replace(/\s+(?:сезон|season)\s*\d+$/i, "")
    .replace(/\s+[IVX]{1,5}$/i, "")
    .trim();
}
export function franchiseKey(title: string) {
  return franchiseName(title).toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export async function fetchFamily(anime: Anime, root = franchiseName(anime.title)) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`/api/yummy?mode=details&ids=${anime.anime_id}`);
      const payload = await response.json();
      if (response.ok) {
        const detail = (payload.anime?.[0] ?? anime) as Anime;
        if (detail.viewing_order?.length)
          return [...new Map(detail.viewing_order.map((item) => [item.anime_id, item])).values()];
      }
    } catch {}
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/yummy?mode=catalog&limit=48&q=${encodeURIComponent(root)}`);
      const payload = await response.json();
      if (response.ok) {
        const rootKey = franchiseKey(root);
        const family = ((payload.anime ?? []) as Anime[]).filter((item) => franchiseKey(item.title) === rootKey);
        if (family.length) return family;
      }
    } catch {}
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  return [anime];
}
export function groupFranchises(items: Anime[]) {
  const groups = new Map<string, Anime[]>();
  for (const anime of items) {
    const key = franchiseKey(anime.title);
    groups.set(key, [...(groups.get(key) ?? []), anime]);
  }
  return [...groups.values()].map((entries) => {
    const ordered = [...entries].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.anime_id - b.anime_id);
    const representative = ordered[0];
    const ratings = entries.map((anime) => anime.rating?.average).filter((value): value is number => typeof value === "number");
    const statusSource =
      entries.find((anime) => releaseStatus(anime).kind === "airing") ??
      entries.find((anime) => releaseStatus(anime).kind === "planned") ??
      representative;
    return {
      ...representative,
      title: entries.length > 1 ? franchiseName(representative.title) : representative.title,
      franchiseCount: entries.length,
      franchiseEntries: entries,
      anime_status: statusSource.anime_status,
      rating: ratings.length ? { average: Math.max(...ratings) } : representative.rating,
      views: entries.reduce((sum, anime) => sum + (anime.views ?? 0), 0),
    };
  });
}
