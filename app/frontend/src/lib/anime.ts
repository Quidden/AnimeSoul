import type { Anime, AnimeProgress, EpisodeState, Video } from "./types";

const ENGLISH_KEYBOARD = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RUSSIAN_KEYBOARD = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const KEYBOARD_LAYOUT = new Map<string, string>();
[...ENGLISH_KEYBOARD].forEach((key, index) => {
  KEYBOARD_LAYOUT.set(key, RUSSIAN_KEYBOARD[index]);
  KEYBOARD_LAYOUT.set(RUSSIAN_KEYBOARD[index], key);
});

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "e", є: "ye",
  ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya",
  ъ: "", ь: "",
};

// Keep these common community names aligned with the backend search aliases.
const ANIME_SEARCH_ALIASES: Record<string, string[]> = {
  aot: ["attack on titan", "shingeki no kyojin", "атака титанов"],
  аот: ["attack on titan", "shingeki no kyojin", "атака титанов"],
  bnha: ["boku no hero academia", "my hero academia", "моя геройская академия"],
  бнха: ["boku no hero academia", "my hero academia", "моя геройская академия"],
  mha: ["my hero academia", "boku no hero academia", "моя геройская академия"],
  мга: ["моя геройская академия", "my hero academia"],
  kny: ["kimetsu no yaiba", "demon slayer", "клинок рассекающий демонов"],
  крд: ["клинок рассекающий демонов", "kimetsu no yaiba", "demon slayer"],
  sao: ["sword art online", "мастера меча онлайн"],
  сао: ["sword art online", "мастера меча онлайн"],
  fma: ["fullmetal alchemist", "стальной алхимик"],
  fmab: ["fullmetal alchemist brotherhood", "стальной алхимик"],
  фма: ["fullmetal alchemist", "стальной алхимик"],
  jjba: ["jojo bizarre adventure", "невероятные приключения джоджо"],
  джджба: ["jojo bizarre adventure", "невероятные приключения джоджо"],
  "ван пис": ["one piece"],
  ванпис: ["one piece"],
  "ре зеро": ["re zero", "re:zero", "жизнь в альтернативном мире с нуля"],
  резеро: ["re zero", "re:zero", "жизнь в альтернативном мире с нуля"],
  магичка: ["магическая битва", "jujutsu kaisen"],
  "др стоун": ["dr stone", "doctor stone"],
  "доктор стоун": ["dr stone", "doctor stone"],
};

const ACRONYM_STOP_WORDS = new Set(["a", "an", "and", "of", "the", "to"]);

export function normalizeAnimeSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("ru-RU")
    .replace(/\u0451/g, "\u0435")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function swapAnimeSearchKeyboard(value: string) {
  return [...value].map(character => KEYBOARD_LAYOUT.get(character) ?? character).join("");
}

function transliterateAnimeSearch(value: string) {
  return [...value].map(character => CYRILLIC_TRANSLITERATION[character] ?? character).join("");
}

export function animeSearchQueryVariants(value: string) {
  const variants: string[] = [];
  const add = (candidate: string) => {
    const normalized = normalizeAnimeSearch(candidate);
    if (normalized && !variants.includes(normalized)) variants.push(normalized);
  };

  const normalized = normalizeAnimeSearch(value);
  add(normalized);
  add(swapAnimeSearchKeyboard(normalized));
  add(transliterateAnimeSearch(normalized));
  [...variants].forEach(candidate => ANIME_SEARCH_ALIASES[candidate]?.forEach(add));
  return variants;
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
  const queries = animeSearchQueryVariants(query);
  if (!queries.length) return 1;
  let best = 0;
  for (const title of animeSearchTitles(anime)) {
    const titleTokens = title.split(" ").filter(Boolean);
    const acronyms = new Set([
      titleTokens.map(token => token[0]).join(""),
      titleTokens.filter(token => !ACRONYM_STOP_WORDS.has(token)).map(token => token[0]).join(""),
    ]);
    const compactTitle = titleTokens.join("");

    queries.forEach((normalizedQuery, index) => {
      const penalty = Math.min(index * 12, 84);
      const tokens = normalizedQuery.split(" ").filter(Boolean);
      const compactQuery = tokens.join("");
      if (title === normalizedQuery) best = Math.max(best, 1000 - penalty);
      else if (title.startsWith(normalizedQuery)) best = Math.max(best, 800 - penalty);
      else if (title.includes(normalizedQuery)) best = Math.max(best, 650 - penalty);

      if (compactQuery.length >= 4 && compactTitle === compactQuery) {
        best = Math.max(best, 900 - penalty);
      } else if (compactQuery.length >= 4 && compactTitle.includes(compactQuery)) {
        best = Math.max(best, 600 - penalty);
      }
      if (tokens.length === 1 && compactQuery.length >= 2 && compactQuery.length <= 10
        && acronyms.has(compactQuery)) {
        best = Math.max(best, 760 - penalty);
      }

      const matchedTokens = tokens.filter(token => title.includes(token)).length;
      if (matchedTokens === tokens.length) {
        best = Math.max(best, 400 + matchedTokens * 20 - penalty);
      }
    });
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
export function episodeResumePosition(state?: EpisodeState) {
  // A completion mark is metadata, not a playback lock. Reopening a watched
  // episode starts a new viewing, but an already-started rewatch must resume
  // from its real position without removing the completion from statistics.
  if (state?.rewatchArmed && (state.percent ?? 0) < 100) {
    return Math.max(0, state.position ?? 0);
  }
  return isEpisodeWatched(state) ? 0 : Math.max(0, state?.position ?? 0);
}
export type ResumePoint = {
  key: string;
  season: number;
  episode: string;
  state: EpisodeState;
};
export function latestResumePoint(progress?: AnimeProgress): ResumePoint | null {
  if (!progress) return null;

  // A manual eye mark exists for statistics only. It must not replace the
  // episode that was actually opened by the player.
  const candidates = Object.entries(progress.episodes)
    .filter(([, state]) =>
      !state.manuallyCompleted &&
      (!isEpisodeWatched(state) || Boolean(state.rewatchArmed && (state.percent ?? 0) < 100)),
    )
    .sort((a, b) => {
      // Opening a player may briefly create a newer 0:00 entry. Prefer an
      // actual playback position so it cannot hide the real continuation.
      const aHasPlayback = episodeResumePosition(a[1]) > 5 ? 1 : 0;
      const bHasPlayback = episodeResumePosition(b[1]) > 5 ? 1 : 0;
      return bHasPlayback - aHasPlayback || b[1].updatedAt - a[1].updatedAt;
    });
  const latest = candidates[0];
  if (!latest) return null;

  const separator = latest[0].indexOf(":");
  const parsedSeason = Number(separator >= 0 ? latest[0].slice(0, separator) : "");
  const parsedEpisode = separator >= 0 ? latest[0].slice(separator + 1) : latest[0];
  return {
    key: latest[0],
    season: parsedSeason > 0 ? parsedSeason : progress.season ?? 1,
    episode: parsedEpisode || progress.episode || "1",
    state: latest[1],
  };
}

/** Resolve local progress before remote catalogue metadata becomes available. */
export function resolveResumeAnime(
  catalog: Anime[],
  animeId: number | undefined,
  storedTitle: string | undefined,
): Anime | undefined {
  if (!animeId) return undefined;
  return catalog.find(anime => anime.anime_id === animeId)
    ?? (storedTitle?.trim()
      ? { anime_id: animeId, title: storedTitle.trim() }
      : undefined);
}

export function toggleEpisodeWatched(state: EpisodeState | undefined, duration: number, updatedAt = Date.now()) {
  const resolvedDuration = Math.max(0, duration || state?.duration || 0);
  if (isEpisodeWatched(state)) {
    if (state?.manuallyCompleted && state.manualPrevious) {
      return { ...state.manualPrevious, updatedAt } satisfies EpisodeState;
    }
    return {
      position: 0,
      duration: resolvedDuration,
      percent: 0,
      updatedAt,
      originAnimeId: state?.originAnimeId,
      originEpisode: state?.originEpisode,
      dub: state?.dub,
      player: state?.player,
      completed: false,
      completions: Math.max(0, (state?.completions ?? 1) - 1),
      completionHistory: state?.completionHistory?.slice(0, -1),
      rewatchArmed: false,
      watchedSeconds: 0,
    } satisfies EpisodeState;
  }
  const manualPrevious = state ? {
    position: state.position,
    duration: state.duration,
    percent: state.percent,
    updatedAt: state.updatedAt,
    originAnimeId: state.originAnimeId,
    originEpisode: state.originEpisode,
    dub: state.dub,
    player: state.player,
    completed: state.completed,
      completions: state.completions,
      completionHistory: state.completionHistory,
      rewatchArmed: state.rewatchArmed,
    watchedSeconds: state.watchedSeconds,
  } : undefined;
  return {
    position: resolvedDuration,
    duration: resolvedDuration,
    percent: 100,
    updatedAt,
    originAnimeId: state?.originAnimeId,
    originEpisode: state?.originEpisode,
    dub: state?.dub,
    player: state?.player,
    completed: true,
      completions: (state?.completions ?? 0) + 1,
      completionHistory: [...(state?.completionHistory ?? []), updatedAt],
      rewatchArmed: false,
    watchedSeconds: resolvedDuration,
    manuallyCompleted: true,
    manualPrevious,
  } satisfies EpisodeState;
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
function abortableRetryDelay(delay: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, delay));
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchFamily(
  anime: Anime,
  root = franchiseName(anime.title),
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`/api/yummy?mode=details&ids=${anime.anime_id}`, { signal });
      const payload = await response.json();
      if (response.ok) {
        const detail = (payload.anime?.[0] ?? anime) as Anime;
        if (detail.viewing_order?.length)
          return [...new Map(detail.viewing_order.map((item) => [item.anime_id, item])).values()];
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (attempt < 3) await abortableRetryDelay(600 * (attempt + 1), signal);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/yummy?mode=catalog&limit=48&q=${encodeURIComponent(root)}`, { signal });
      const payload = await response.json();
      if (response.ok) {
        const rootKey = franchiseKey(root);
        const family = ((payload.anime ?? []) as Anime[]).filter((item) => franchiseKey(item.title) === rootKey);
        if (family.length) return family;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (attempt < 2) await abortableRetryDelay(700 * (attempt + 1), signal);
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
    const ratingKeys = new Set(entries.flatMap(anime => Object.keys(anime.rating ?? {})));
    const ratings = Object.fromEntries([...ratingKeys].flatMap(key => {
      const values = entries
        .map(anime => anime.rating?.[key])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return values.length ? [[key, Math.max(...values)]] : [];
    }));
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
      rating: Object.keys(ratings).length ? ratings : representative.rating,
      views: entries.reduce((sum, anime) => sum + (anime.views ?? 0), 0),
    };
  });
}
