import type {Anime, HeroTrailer, ScheduleEntry, Video} from "../../lib/types";
import {requestJson} from "../../lib/http";

type AnimePayload = {anime?: Anime[]; error?: string};
type VideoPayload = {
    anime?: Anime;
    videos?: Video[];
    error?: string;
    detail?: string;
    _sources?: Record<string, string>;
};
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
const DETAILS_CACHE_TTL = 12 * 60 * 60_000;
const VIDEO_CACHE_TTL = 10 * 60_000;
export type AnimeVideoResult = {
    anime?: Anime;
    videos: Video[];
    sources: Record<string, string>;
};

export class CatalogVideoRequestError extends Error {
    readonly sources: Record<string, string>;
    readonly status: number;

    constructor(message: string, status: number, sources: Record<string, string>) {
        super(message);
        this.name = "CatalogVideoRequestError";
        this.status = status;
        this.sources = sources;
    }
}

const videoCache = new Map<number, { expiresAt: number; request: Promise<AnimeVideoResult> }>();
const detailsCache = new Map<number, { expiresAt: number; request: Promise<Anime | undefined> }>();

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
export async function fetchAnimeDetails(
    ids: number[],
    options: { refresh?: boolean } = {},
): Promise<Anime[]> {
    const requested = [...new Set(ids)].filter(Number.isFinite);
    if (!requested.length) return [];
    const now = Date.now();
    const missing = requested.filter(animeId => {
        const cached = detailsCache.get(animeId);
        if (!options.refresh && cached && cached.expiresAt > now) return false;
        if (cached) detailsCache.delete(animeId);
        return true;
    });

    if (missing.length) {
        for (let start = 0; start < missing.length; start += 50) {
            const batchIds = missing.slice(start, start + 50);
            const params = new URLSearchParams({
                mode: "details",
                ids: batchIds.join(","),
            });
            if (options.refresh) params.set("refresh", "true");
            const batch = requestJson<AnimePayload>(`/api/yummy?${params.toString()}`)
                .then(payload => payload.anime ?? []);
            for (const animeId of batchIds) {
                const request = batch
                    .then(anime => anime.find(item => item.anime_id === animeId))
                    .then(anime => {
                        if (!anime) detailsCache.delete(animeId);
                        return anime;
                    })
                    .catch(error => {
                        detailsCache.delete(animeId);
                        throw error;
                    });
                detailsCache.set(animeId, {
                    expiresAt: now + DETAILS_CACHE_TTL,
                    request,
                });
            }
        }
    }

    const resolved = await Promise.all(requested.map(animeId =>
        detailsCache.get(animeId)?.request ?? Promise.resolve(undefined),
    ));
    return resolved.filter((anime): anime is Anime => Boolean(anime));
}

/** Load all player variants and episodes exposed for one API anime record. */
export async function fetchAnimeVideos(animeId: number): Promise<Video[]> {
    return (await fetchAnimeVideoResult(animeId)).videos;
}

/**
 * Load videos together with per-provider status information.
 *
 * The in-flight cache is important on the watch page: discovering the full
 * franchise can request the already selected title a second time. Reusing the
 * first request keeps that enrichment from restarting local or online loading.
 */
export async function fetchAnimeVideoResult(
    animeId: number,
    options: { refresh?: boolean } = {},
): Promise<AnimeVideoResult> {
    const now = Date.now();
    const cached = videoCache.get(animeId);
    if (!options.refresh && cached && cached.expiresAt > now) return cached.request;
    if (cached) videoCache.delete(animeId);
    const request = requestAnimeVideos(animeId, Boolean(options.refresh))
        .catch(error => {
            videoCache.delete(animeId);
            throw error;
        });
    videoCache.set(animeId, { expiresAt: now + VIDEO_CACHE_TTL, request });
    return request;
}

async function requestAnimeVideos(
    animeId: number,
    refresh: boolean,
): Promise<AnimeVideoResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
        15_000,
    );
    try {
        const params = new URLSearchParams({mode: "videos", id: String(animeId)});
        if (refresh) params.set("refresh", "true");
        const response = await fetch(`/api/yummy?${params.toString()}`, {
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as VideoPayload;
        const sources = payload._sources ?? sourceStatesFromHeaders(response.headers);
        if (!response.ok) {
            throw new CatalogVideoRequestError(
                payload.detail || payload.error || `API request failed with status ${response.status}`,
                response.status,
                sources,
            );
        }
        return {
            anime: payload.anime,
            videos: Array.isArray(payload.videos) ? payload.videos : [],
            sources,
        };
    } catch (error) {
        if (error instanceof CatalogVideoRequestError) throw error;
        const message = error instanceof DOMException && error.name === "TimeoutError"
            ? "Источники не ответили за 15 секунд."
            : error instanceof Error ? error.message : "Не удалось загрузить серии.";
        throw new CatalogVideoRequestError(message, 0, {});
    } finally {
        clearTimeout(timeout);
    }
}

function sourceStatesFromHeaders(headers: Headers): Record<string, string> {
    const sources: Record<string, string> = {};
    const yummy = headers.get("X-AnimeSoul-Yummy-Status");
    const kodik = headers.get("X-AnimeSoul-Kodik-Status");
    if (yummy) sources.yummy = yummy;
    if (kodik) sources.kodik = kodik;
    return sources;
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
