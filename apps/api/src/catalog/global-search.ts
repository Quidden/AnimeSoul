import { ServiceUnavailableException } from "@nestjs/common";
import {
  normalizeSearchText,
  createSearchScorer,
  parseGlobalSearch,
  scoreSearchText,
  type Anime,
  type GlobalSearchQuery,
  type GlobalSearchResponse,
  type SearchAnime,
} from "@animesoul/contracts";
import type { Database, Prisma } from "@animesoul/database";
import { developmentAnime, developmentProfile } from "@animesoul/database/fixtures";
import type { Configuration } from "../config.js";
import { person, personSelect, visiblePeople } from "../social/access.js";
import { enrichAnime } from "./discovery.js";
import { searchCharacters } from "./characters.js";

const cacheLifetime = 45000;
const indexLimit = 20000;
type SearchRow = Pick<
  Anime,
  | "id"
  | "slug"
  | "title"
  | "originalTitle"
  | "aliases"
  | "genres"
  | "year"
  | "status"
  | "format"
  | "popularity"
  | "shikimoriScore"
>;
type IndexedAnime = SearchRow & { names: string[]; viewers: number };
type SearchIndex = {
  anime: IndexedAnime[];
  people: GlobalSearchResponse["people"];
  genres: GlobalSearchResponse["genres"];
};
type CachedIndex = { until: number; value?: SearchIndex; pending?: Promise<SearchIndex> };
const indexes = new WeakMap<Database, Map<boolean, CachedIndex>>();

function published(production: boolean): Prisma.AnimeWhereInput {
  return {
    published: true,
    metadataProvider: { not: "legacy" },
    ...(production ? { isDevelopment: false } : {}),
  };
}

const shortNames = [
  {
    names: ["атака титанов", "attack on titan", "shingeki no kyojin"],
    aliases: ["aot", "аот", "snk"],
  },
  { names: ["тетрадь смерти", "death note"], aliases: ["dn"] },
  {
    names: ["клинок рассекающий демонов", "demon slayer", "kimetsu no yaiba"],
    aliases: ["kny", "крд"],
  },
  { names: ["магическая битва", "jujutsu kaisen"], aliases: ["jjk", "жжк"] },
  {
    names: ["моя геройская академия", "boku no hero academia", "my hero academia"],
    aliases: ["bnha", "mha", "мга"],
  },
  { names: ["sword art online", "мастера меча онлайн"], aliases: ["sao", "сао"] },
] as const;

function indexed(
  rows: SearchRow[],
  recent = new Map<string, number>(),
  people: GlobalSearchResponse["people"] = [],
): SearchIndex {
  const genres = new Map<string, { name: string; count: number; popularity: number }>();
  const anime = rows.map((row) => {
    const names = [
      ...new Set(
        [row.title, row.originalTitle, ...row.aliases].map(normalizeSearchText).filter(Boolean),
      ),
    ];
    for (const entry of shortNames)
      if (entry.names.some((name) => names.some((candidate) => candidate.includes(name))))
        names.push(...entry.aliases);
    for (const name of new Set(row.genres)) {
      if (!name.trim() || name.length > 100) continue;
      const value = genres.get(name) ?? { name, count: 0, popularity: 0 };
      value.count++;
      value.popularity += row.popularity ?? 0;
      genres.set(name, value);
    }
    return { ...row, names, viewers: recent.get(row.id) ?? 0 };
  });
  return {
    anime,
    people,
    genres: [...genres.values()]
      .sort(
        (a, b) =>
          b.count - a.count || b.popularity - a.popularity || a.name.localeCompare(b.name, "ru"),
      )
      .slice(0, 100)
      .map(({ name, count }) => ({ name, count })),
  };
}

async function loadIndex(db: Database, production: boolean): Promise<SearchIndex> {
  const [rows, recent, profiles] = await Promise.all([
    db.anime.findMany({
      where: published(production),
      select: {
        id: true,
        slug: true,
        title: true,
        originalTitle: true,
        aliases: true,
        genres: true,
        year: true,
        status: true,
        format: true,
        popularity: true,
        shikimoriScore: true,
      },
      orderBy: [{ popularity: "desc" }, { id: "asc" }],
      take: indexLimit,
    }),
    db.$queryRaw<{ animeId: string; viewers: number }[]>`
      WITH watching AS (
        SELECT "animeId", "userId" FROM "EpisodeProgress"
        WHERE "updatedAt" >= ${new Date(Date.now() - 7 * 86400000)}
          AND ("watchedSeconds" > 0 OR "position" > 0 OR "completed")
        UNION
        SELECT "animeId", "userId" FROM "LibraryItem"
        WHERE "updatedAt" >= ${new Date(Date.now() - 7 * 86400000)}
          AND ("lastEpisode" <> '' OR jsonb_path_exists("progressDetails",
            '$.* ? (@.completed == true || @.position > 0 || @.watchedSeconds > 0 || @.percent > 0)'))
      )
      SELECT w."animeId", COUNT(DISTINCT w."userId")::int AS "viewers"
      FROM watching w
      JOIN "User" u ON u."id" = w."userId" AND u."disabledAt" IS NULL
      JOIN "Anime" a ON a."id" = w."animeId"
      WHERE a."published" AND a."metadataProvider" <> 'legacy'
        AND (${!production} OR NOT a."isDevelopment")
      GROUP BY w."animeId" ORDER BY "viewers" DESC, w."animeId" LIMIT ${indexLimit}
    `,
    db.userProfile.findMany({
      where: { user: { disabledAt: null } },
      select: personSelect,
      orderBy: [{ usernameKey: "asc" }, { userId: "asc" }],
      take: indexLimit,
    }),
  ]);
  return indexed(
    rows as SearchRow[],
    new Map(recent.map((row) => [row.animeId, row.viewers])),
    profiles.map(person),
  );
}

async function searchIndex(db: Database, production: boolean) {
  let cache = indexes.get(db);
  if (!cache) indexes.set(db, (cache = new Map()));
  const existing = cache.get(production);
  if (existing?.value && existing.until > Date.now()) return existing.value;
  if (existing?.pending) return existing.pending;
  const entry: CachedIndex = { until: 0 };
  const pending = loadIndex(db, production).then(
    (value) => {
      entry.value = value;
      entry.until = Date.now() + cacheLifetime;
      delete entry.pending;
      return value;
    },
    (error: unknown) => {
      cache.delete(production);
      throw error;
    },
  );
  entry.pending = pending;
  cache.set(production, entry);
  return pending;
}

function popularity(a: IndexedAnime, b: IndexedAnime) {
  return (
    b.viewers - a.viewers ||
    (b.popularity ?? 0) - (a.popularity ?? 0) ||
    (b.shikimoriScore ?? 0) - (a.shikimoriScore ?? 0) ||
    a.title.localeCompare(b.title, "ru")
  );
}

type SavedProgress = {
  animeId: string;
  episodeKey: string;
  position: number;
  duration: number;
  watchedSeconds: number;
  completed: boolean;
  updatedAt: Date;
  episode: { season: string; number: string } | null;
};
type SavedLibrary = {
  animeId: string;
  lastEpisode: string;
  season: number;
  tracking: Prisma.JsonValue;
};

function episodeCounts(anime: Anime, registered: number): SearchAnime["episodes"] {
  const total =
    (anime.details?.episodesTotal || null) ??
    (anime.status === "released"
      ? anime.details?.episodesAired || (anime.format === "movie" ? 1 : null)
      : null);
  const available =
    anime.status === "announced"
      ? 0
      : ((anime.details?.episodesAired || null) ??
        (anime.status === "released" ? total : null) ??
        (registered || null));
  return { total, available };
}

function progressEpisode(row: SavedProgress) {
  if (row.episode) return row.episode;
  // Older account progress uses a season:number or a plain episode number.
  const pair = /^(\d+):(\d+(?:\.\d+)?)$/.exec(row.episodeKey);
  if (pair) return { season: pair[1]!, number: pair[2]! };
  const number = /^(?:legacy:)?(\d+(?:\.\d+)?)$/.exec(row.episodeKey);
  return number ? { season: "", number: number[1]! } : null;
}

function watchSummary(
  anime: Anime,
  episodes: SearchAnime["episodes"],
  saved: SavedProgress[],
  library: SavedLibrary | undefined,
): NonNullable<SearchAnime["watchProgress"]> {
  const distinct = new Map<string, SavedProgress>();
  const knownByNumber = new Map<string, Map<string, { season: string; number: string }>>();
  for (const row of saved) {
    const episode = progressEpisode(row);
    if (!episode?.season) continue;
    let seasons = knownByNumber.get(episode.number);
    if (!seasons) knownByNumber.set(episode.number, (seasons = new Map()));
    seasons.set(episode.season, episode);
  }
  const uncertain: SavedProgress[] = [];
  for (const row of saved) {
    let episode = progressEpisode(row);
    if (episode && !episode.season) {
      const matches = knownByNumber.get(episode.number);
      if (matches?.size === 1) episode = [...matches.values()][0]!;
      else if (matches && matches.size > 1) {
        // Its season is unknown. It may duplicate either canonical episode; do not inflate counts.
        uncertain.push(row);
        continue;
      }
    }
    const key = episode ? JSON.stringify([episode.season, episode.number]) : row.episodeKey;
    const previous = distinct.get(key);
    // Canonical and migrated keys can refer to the same episode. Its newest state wins.
    if (!previous || row.updatedAt > previous.updatedAt) distinct.set(key, row);
  }
  const started = [...distinct.values()]
    .filter((row) => row.completed || row.position > 0 || row.watchedSeconds > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const completedEpisodes = started.filter((row) => row.completed).length;
  const uncertainStarted = uncertain.filter(
    (row) => row.completed || row.position > 0 || row.watchedSeconds > 0,
  );
  const fraction = (row: SavedProgress) =>
    row.completed ? 1 : row.duration > 0 ? Math.min(0.99, row.position / row.duration) : 0;
  const denominator = episodes.total || episodes.available;
  const tracking =
    library?.tracking && typeof library.tracking === "object" && !Array.isArray(library.tracking)
      ? library.tracking
      : {};
  const manuallyCompleted = tracking.status === "completed";
  const hasStarted =
    started.length > 0 ||
    uncertainStarted.length > 0 ||
    Boolean(library?.lastEpisode) ||
    manuallyCompleted;
  const status =
    anime.status === "released" &&
    (manuallyCompleted || (episodes.total !== null && completedEpisodes >= episodes.total))
      ? "completed"
      : anime.status === "ongoing" &&
          episodes.available !== null &&
          episodes.available > 0 &&
          completedEpisodes >= episodes.available
        ? "caught_up"
        : hasStarted
          ? "watching"
          : "not_started";
  const latest = [...started, ...uncertainStarted].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )[0];
  const last = latest
    ? progressEpisode(latest)
    : library?.lastEpisode && /^(?:legacy:)?\d+(?:\.\d+)?$/.test(library.lastEpisode)
      ? { season: String(library.season), number: library.lastEpisode.replace(/^legacy:/, "") }
      : null;
  return {
    status,
    completedEpisodes,
    startedEpisodes: started.length,
    percent:
      status === "completed"
        ? 100
        : !hasStarted
          ? 0
          : !uncertainStarted.length &&
              denominator &&
              started.length &&
              !started.some((row) => !row.completed && row.duration <= 0)
            ? Math.min(
                status === "caught_up" ? 100 : 99.9,
                (started.reduce((sum, row) => sum + fraction(row), 0) / denominator) * 100,
              )
            : null,
    lastEpisode: last
      ? {
          ...last,
          percent:
            latest && (latest.duration > 0 || latest.completed) ? fraction(latest) * 100 : null,
        }
      : null,
  };
}

async function addWatchProgress(
  db: Database,
  anime: Anime[],
  viewer?: string,
): Promise<SearchAnime[]> {
  if (!anime.length) return [];
  const ids = anime.map((row) => row.id);
  const [counts, progress, library] = await Promise.all([
    db.episode.groupBy({
      by: ["animeId"],
      where: { animeId: { in: ids } },
      _count: { _all: true },
    }),
    viewer
      ? db.episodeProgress.findMany({
          where: { userId: viewer, animeId: { in: ids } },
          select: {
            animeId: true,
            episodeKey: true,
            position: true,
            duration: true,
            watchedSeconds: true,
            completed: true,
            updatedAt: true,
            episode: { select: { season: true, number: true } },
          },
          take: 20000,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    viewer
      ? db.libraryItem.findMany({
          where: { userId: viewer, animeId: { in: ids } },
          select: { animeId: true, lastEpisode: true, season: true, tracking: true },
          take: 8,
        })
      : [],
  ]);
  const registered = new Map(counts.map((row) => [row.animeId, row._count._all]));
  const libraries = new Map(library.map((row) => [row.animeId, row]));
  return anime.map((row) => {
    const episodes = episodeCounts(row, registered.get(row.id) ?? 0);
    return {
      ...row,
      episodes,
      watchProgress: viewer
        ? watchSummary(
            row,
            episodes,
            progress.filter((entry) => entry.animeId === row.id),
            libraries.get(row.id),
          )
        : null,
    };
  });
}

function matchedAnime(index: SearchIndex, query: GlobalSearchQuery) {
  const parsed = parseGlobalSearch(query.q);
  if (parsed.issues.length) return { matches: [], correction: null };
  const text = normalizeSearchText(parsed.text);
  const scoreName = createSearchScorer(text);
  const scoredNames = new Map<string, number>();
  const relevance = (row: IndexedAnime) => {
    if (!text) return 1;
    let best = 0;
    for (const name of row.names) {
      let score = scoredNames.get(name);
      if (score === undefined) {
        score = scoreName(name, true);
        scoredNames.set(name, score);
      }
      if (score > best) best = score;
      if (best === 1000) break;
    }
    return best;
  };
  const genre = parsed.filters.genre ? normalizeSearchText(parsed.filters.genre) : "";
  const knownGenre = genre
    ? (index.genres.find((entry) => normalizeSearchText(entry.name) === genre)?.name ??
      index.genres
        .map((entry) => ({ entry, score: scoreSearchText(genre, entry.name) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.count - a.entry.count)[0]?.entry.name)
    : undefined;
  const matches = index.anime
    .filter(
      (row) =>
        (!genre || (knownGenre && row.genres.includes(knownGenre))) &&
        (!parsed.filters.status || row.status === parsed.filters.status) &&
        (!parsed.filters.format || row.format === parsed.filters.format) &&
        (!parsed.filters.from || row.year >= parsed.filters.from) &&
        (!parsed.filters.to || row.year <= parsed.filters.to) &&
        (parsed.filters.minRating === undefined ||
          (row.shikimoriScore ?? -1) >= parsed.filters.minRating),
    )
    .map((row) => ({
      row,
      score: relevance(row),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || popularity(a.row, b.row))
    .slice(0, query.q ? 8 : 3);
  const top = matches[0];
  const correction =
    top && text && top.score <= 550 && !top.row.names.some((name) => name.includes(text))
      ? top.row.title.slice(0, 500)
      : null;
  return { matches: matches.map((result) => result.row), correction };
}

async function searchPeople(db: Database, index: SearchIndex, text: string, viewer?: string) {
  if (!text) return [];
  const identity = text.replace(/^@/, "").trim();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    identity,
  );
  const where = visiblePeople(viewer);
  if (uuid) {
    const rows = await db.userProfile.findMany({
      where: { AND: [where, { userId: identity.toLowerCase() }] },
      select: personSelect,
      take: 1,
    });
    return rows.map(person);
  }
  if (identity.length < 2 || identity.length > 80) return [];
  const normalized = normalizeSearchText(identity);
  const scorePerson = createSearchScorer(normalized);
  const candidates = index.people
    .map((row) => ({ row, score: scorePerson(row.username) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.row.username.localeCompare(b.row.username, "ru"))
    .slice(0, 64);
  if (!candidates.length) return [];
  // Cached names are only candidates. Always apply current visibility and both block directions.
  const rows = await db.userProfile.findMany({
    where: { AND: [where, { userId: { in: candidates.map((candidate) => candidate.row.id) } }] },
    select: personSelect,
    take: 64,
  });
  return rows
    .map((row) => ({ row, score: scorePerson(row.username) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.row.username.localeCompare(b.row.username, "ru"))
    .slice(0, 6)
    .map((result) => person(result.row));
}

export async function globalSearch(
  db: Database | undefined,
  config: Configuration,
  input: GlobalSearchQuery,
  viewer?: string,
): Promise<GlobalSearchResponse> {
  const parsed = parseGlobalSearch(input.q);
  if (config.DEMO_CATALOG === "true") {
    const index = indexed(developmentAnime);
    const result = matchedAnime(index, input);
    const personMatch =
      parsed.text &&
      !Object.keys(parsed.filters).length &&
      (parsed.text.toLowerCase() === developmentProfile.id ||
        scoreSearchText(parsed.text.replace(/^@/, ""), developmentProfile.username) > 0);
    return {
      query: input.q,
      anime: result.matches.map((row) => {
        const anime = developmentAnime.find((anime) => anime.id === row.id)!;
        const episodes = episodeCounts(anime, 0);
        return {
          ...anime,
          episodes,
          watchProgress: viewer ? watchSummary(anime, episodes, [], undefined) : null,
        };
      }),
      people: personMatch
        ? [
            {
              id: developmentProfile.id,
              username: developmentProfile.username,
              avatar: developmentProfile.avatar,
            },
          ]
        : [],
      genres: index.genres,
      characters:
        parsed.issues.length || Object.keys(parsed.filters).length
          ? []
          : await searchCharacters(db, config, parsed.text),
      correction: result.correction,
    };
  }
  if (!db) throw new ServiceUnavailableException("Search database is not configured.");
  const production = config.NODE_ENV === "production";
  const index = await searchIndex(db, production);
  const people =
    parsed.issues.length || Object.keys(parsed.filters).length
      ? []
      : await searchPeople(db, index, parsed.text, viewer);
  const result = matchedAnime(index, input);
  const characters =
    parsed.issues.length || Object.keys(parsed.filters).length
      ? []
      : await searchCharacters(db, config, parsed.text, { discover: result.matches.length === 0 });
  // Recheck publication when returning rows, so unpublishing takes effect before cache expiry.
  const rows = result.matches.length
    ? await db.anime.findMany({
        where: { ...published(production), id: { in: result.matches.map((row) => row.id) } },
        take: 8,
      })
    : [];
  const enriched = await enrichAnime(db, rows);
  const order = new Map(result.matches.map((row, index) => [row.id, index]));
  enriched.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    query: input.q,
    anime: await addWatchProgress(db, enriched, viewer),
    people,
    characters,
    genres: index.genres,
    correction: enriched[0]?.id === result.matches[0]?.id ? result.correction : null,
  };
}
