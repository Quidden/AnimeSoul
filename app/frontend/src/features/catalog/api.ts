import type {Anime, HeroTrailer, ScheduleEntry, Video} from "../../lib/types";

type AnimePayload = {anime?: Anime[]; error?: string};
type VideoPayload = {videos?: Video[]; error?: string};
type SchedulePayload = {schedule?: ScheduleEntry[]; error?: string};
type TrailerPayload = {trailers?: unknown; error?: string};

type CatalogPageOptions = {
    limit: number;
    offset: number;
    query?: string;
};

type CatalogCacheEntry = {
    expiresAt: number;
    request: Promise<Anime[]>;
};

const CATALOG_SEARCH_CACHE_TTL = 5 * 60_000;
const CATALOG_SEARCH_CACHE_LIMIT = 40;
const catalogSearchCache = new Map<string, CatalogCacheEntry>();

async function requestJson<T extends {error?: string}>(url: string): Promise<T> {
    const response = await fetch(url);
    const payload = await response.json() as T;
    if (!response.ok) {
        throw new Error(payload.error || `API request failed with status ${response.status}`);
    }
    return payload;
}

/** Load one catalog page. Filtering and franchise grouping stay in selectors/UI code. */
export async function fetchCatalogPage({limit, offset, query}: CatalogPageOptions): Promise<Anime[]> {
    const normalizedQuery = query?.trim();
    if (normalizedQuery && offset === 0) {
        return cachedCatalogSearch(normalizedQuery, limit);
    }
    return requestCatalogPage({limit, offset, query: normalizedQuery});
}

/** Start a search before submit so Enter can reuse the same in-flight request. */
export function prefetchCatalogSearch(query: string, limit = 24) {
    const normalizedQuery = query.trim();
    return normalizedQuery
        ? cachedCatalogSearch(normalizedQuery, limit)
        : Promise.resolve([]);
}

function cachedCatalogSearch(query: string, limit: number) {
    const key = `${query.toLocaleLowerCase("ru-RU")}:${limit}`;
    const now = Date.now();
    const cached = catalogSearchCache.get(key);
    if (cached && cached.expiresAt > now) return cached.request;
    if (cached) catalogSearchCache.delete(key);

    const request = requestCatalogPage({limit, offset: 0, query})
        .catch(error => {
            catalogSearchCache.delete(key);
            throw error;
        });
    catalogSearchCache.set(key, {
        expiresAt: now + CATALOG_SEARCH_CACHE_TTL,
        request,
    });
    trimCatalogSearchCache(now);
    return request;
}

function trimCatalogSearchCache(now: number) {
    for (const [key, entry] of catalogSearchCache) {
        if (entry.expiresAt <= now) catalogSearchCache.delete(key);
    }
    while (catalogSearchCache.size > CATALOG_SEARCH_CACHE_LIMIT) {
        const oldestKey = catalogSearchCache.keys().next().value;
        if (oldestKey === undefined) break;
        catalogSearchCache.delete(oldestKey);
    }
}

async function requestCatalogPage({limit, offset, query}: CatalogPageOptions) {
    const params = new URLSearchParams({
        mode: "catalog",
        limit: String(limit),
        offset: String(offset),
    });
    if (query) params.set("q", query);
    const payload = await requestJson<AnimePayload>(`/api/yummy?${params.toString()}`);
    return payload.anime ?? [];
}

/** Load full metadata for known anime identifiers. */
export async function fetchAnimeDetails(ids: number[]): Promise<Anime[]> {
    if (!ids.length) return [];
    const payload = await requestJson<AnimePayload>(
        `/api/yummy?mode=details&ids=${ids.join(",")}`,
    );
    return payload.anime ?? [];
}

/** Load all player variants and episodes exposed for one API anime record. */
export async function fetchAnimeVideos(animeId: number): Promise<Video[]> {
    const payload = await requestJson<VideoPayload>(
        `/api/yummy?mode=videos&id=${animeId}`,
    );
    return payload.videos ?? [];
}

/** Load and normalize trailer sources exposed by YummyAnime for one title. */
export async function fetchAnimeTrailers(animeId: number): Promise<HeroTrailer[]> {
    const payload = await requestJson<TrailerPayload>(
        `/api/yummy?mode=trailers&id=${animeId}`,
    );
    return normalizeTrailers(payload.trailers);
}

export async function fetchReleaseSchedule(): Promise<ScheduleEntry[]> {
    const payload = await requestJson<SchedulePayload>("/api/yummy?mode=schedule");
    return payload.schedule ?? [];
}

function normalizeTrailers(payload: unknown): HeroTrailer[] {
    const candidates: HeroTrailer[] = [];
    const visited = new Set<unknown>();

    const visit = (value: unknown, context: Record<string, unknown> = {}) => {
        if (value == null || visited.has(value)) return;
        if (typeof value === "string") {
            const trailer = trailerFromUrl(value, context);
            if (trailer) candidates.push(trailer);
            return;
        }
        if (typeof value !== "object") return;
        visited.add(value);

        if (Array.isArray(value)) {
            value.forEach(item => visit(item, context));
            return;
        }

        const record = value as Record<string, unknown>;
        const merged = {...context, ...record};
        const youtubeId = firstString(record, ["youtube_id", "youtubeId", "video_id"]);
        if (youtubeId && /^[\w-]{6,}$/.test(youtubeId)) {
            candidates.push({
                url: youtubeEmbedUrl(youtubeId),
                kind: "embed",
                title: firstString(merged, ["title", "name"]),
                poster: firstString(merged, ["poster", "image", "thumbnail"])
                    ?? youtubePosterUrl(youtubeId),
            });
        }

        for (const key of [
            "iframe_url", "embed_url", "trailer_url", "youtube_url",
            "url", "link", "video", "src",
        ]) {
            const source = record[key];
            if (typeof source === "string") {
                const trailer = trailerFromUrl(source, merged);
                if (trailer) candidates.push(trailer);
            }
        }

        Object.values(record).forEach(item => visit(item, merged));
    };

    visit(payload);
    return candidates.filter((trailer, index, all) =>
        all.findIndex(candidate => candidate.url === trailer.url) === index,
    );
}

function trailerFromUrl(
    rawUrl: string,
    context: Record<string, unknown>,
): HeroTrailer | null {
    const url = rawUrl.trim();
    if (!url || /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(url)) return null;

    const youtubeId = extractYoutubeId(url);
    const normalizedUrl = youtubeId ? youtubeEmbedUrl(youtubeId) : url;
    const kind = /\.(?:mp4|webm|ogg)(?:\?|$)/i.test(url) ? "video" : "embed";

    return {
        url: normalizedUrl,
        kind,
        title: firstString(context, ["title", "name"]),
        poster: firstString(context, ["poster", "image", "thumbnail"])
            ?? (youtubeId ? youtubePosterUrl(youtubeId) : undefined),
    };
}

function firstString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}

function extractYoutubeId(url: string) {
    const match = url.match(
        /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i,
    );
    return match?.[1];
}

function youtubeEmbedUrl(id: string) {
    // Playback parameters belong to the surface that renders the trailer.
    // Keeping this URL canonical prevents a hidden one-video playlist from
    // re-enabling YouTube's previous/next overlay on the home page.
    return `https://www.youtube-nocookie.com/embed/${id}`;
}

function youtubePosterUrl(id: string) {
    return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}
