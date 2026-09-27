import { animeFormat } from "../../lib/catalogFilters";
import {useOngoingCatalog} from "./useOngoingCatalog";
import {
    type Dispatch,
    type SetStateAction,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import type { Anime, Folder, Progress, UserRatings, Video } from "../../lib/types";
import { STORAGE_KEYS as K } from "../../lib/settings";
import {
    franchiseKey,
    groupFranchises,
    releaseStatus,
} from "../../lib/anime";
import { writeLocal as write } from "../../lib/storage";
import { routeFromLocation } from "../navigation/routes";

import {
    fetchAnimeDetails,
    fetchAnimeVideos,
    fetchCatalogPage,
    prefetchCatalogSearch,
} from "./api";

function pageFromLocation(): number {
    const value = Number(new URLSearchParams(window.location.search).get("page") ?? 1);
    return Number.isInteger(value) && value >= 1 ? Math.min(value, 10) : 1;
}

export type ApplicationView = "home" | "catalog" | "stats" | "ratings" | "downloads" | "remote" | "tracking" | "library" | "history" | "notFound";

interface UseCatalogControllerOptions {
    favorites: number[];
    folders: Folder[];
    progress: Progress;
    ratings: UserRatings;
    setProgress: Dispatch<SetStateAction<Progress>>;
}

/**
 * Owns catalog navigation, filters and remote loading.
 *
 * Keeping this state together prevents App.tsx from knowing how pagination,
 * franchise grouping and background episode statistics are implemented.
 */
export function useCatalogController({
    favorites,
    folders,
    progress,
    ratings,
    setProgress,
}: UseCatalogControllerOptions) {
    const [catalog, setCatalog] = useState<Anime[]>([]);
    const [active, setActive] = useState<Anime | null>(null);
    const [resumeRequested, setResumeRequested] = useState(false);
    const [newEpisodeRequested, setNewEpisodeRequested] = useState(false);
    const [view, setView] = useState<ApplicationView>(() => {
        if (typeof window === "undefined") return "home";
        const route = routeFromLocation();
        return route === "anime" || route === "animeMap" ? "catalog" : route;
    });

    const catalogParam = (key: string, fallback: string) =>
        typeof window === "undefined" ? fallback : new URLSearchParams(window.location.search).get(key) ?? fallback;
    const [query, setQuery] = useState(() => catalogParam("q", ""));
    const ongoing = useOngoingCatalog(view === "catalog" && !active && !query.trim());
    const [genre, setGenre] = useState(() => catalogParam("genre", "Все"));
    const [sort, setSort] = useState(() => catalogParam("sort", "rating-desc"));
    const [yearFrom, setYearFrom] = useState(() => catalogParam("yearFrom", ""));
    const [yearTo, setYearTo] = useState(() => catalogParam("yearTo", ""));
    const [groupFilter, setGroupFilter] = useState(() => catalogParam("group", "all"));
    const [formatFilter, setFormatFilter] = useState(() => catalogParam("format", "all"));
    const [statusFilter, setStatusFilter] = useState(() => catalogParam("status", "all"));
    const [dubbingFilter, setDubbingFilter] = useState(() => catalogParam("dubbing", "all"));
    const [ratingSource, setRatingSource] = useState(() => catalogParam("ratingSource", "average"));
    const [ratingFrom, setRatingFrom] = useState(() => catalogParam("ratingFrom", ""));

    const [randomOpen, setRandomOpen] = useState(false);
    const [randomGenre, setRandomGenre] = useState("Все");
    const [randomYearFrom, setRandomYearFrom] = useState("");
    const [randomYearTo, setRandomYearTo] = useState("");
    const [randomRating, setRandomRating] = useState("0");

    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [catalogReady, setCatalogReady] = useState(false);
    const [error, setError] = useState("");
    const loadRequestRef = useRef(0);
    const catalogPageRef = useRef(typeof window === "undefined" ? 1 : pageFromLocation());

    useEffect(() => {
        if (active) setView("catalog");
    }, [active]);

    async function load(next = 0, append = false, search = query) {
        const requestId = ++loadRequestRef.current;
        setCatalogReady(true);
        setLoading(true);
        setError("");

        try {
            let anime: Anime[] = [];
            let loadedOffset = next;
            const pages = next === 0 && !append && window.location.pathname === "/catalog"
                ? pageFromLocation() : 1;
            for (let index = 0; index < pages; index += 1) {
                const batch = await fetchCatalogPage({limit: 24, offset: loadedOffset, query: search});
                anime = [...anime, ...batch];
                loadedOffset += batch.length;
                if (batch.length < 24) break;
            }

            if (requestId !== loadRequestRef.current) return;
            setCatalog(current => {
                if (append) return uniqueAnime([...current, ...anime]);
                return anime;
            });
            if (!search.trim()) setOffset(loadedOffset);
        } catch (loadError) {
            if (requestId !== loadRequestRef.current) return;
            setError(loadError instanceof Error
                ? loadError.message
                : "Ошибка каталога");
        } finally {
            if (requestId === loadRequestRef.current) setLoading(false);
        }
    }
    const loadLatestRef = useRef(load);
    loadLatestRef.current = load;

    useEffect(() => {
        const restorePage = () => {
            if (window.location.pathname !== "/catalog") return;
            const page = pageFromLocation();
            if (page === catalogPageRef.current) return;
            catalogPageRef.current = page;
            void loadLatestRef.current(0, false, new URLSearchParams(window.location.search).get("q") ?? "");
        };
        window.addEventListener("popstate", restorePage);
        window.addEventListener("animesoul:navigation", restorePage);
        return () => {
            window.removeEventListener("popstate", restorePage);
            window.removeEventListener("animesoul:navigation", restorePage);
        };
    }, []);

    useEffect(() => {
        const search = query.trim();
        if (search.length < 2) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            void prefetchCatalogSearch(search).then(anime => {
                if (!cancelled) {
                    setCatalog(current => uniqueAnime([...anime, ...current]));
                }
            }).catch(() => undefined);
        }, 300);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [query]);

    async function loadMore() {
        if (statusFilter === "airing") {
            if (ongoing.hasMore) await ongoing.load();
            return;
        }
        setLoading(true);
        setError("");

        try {
            const existingIds = new Set(catalog.map(anime => anime.anime_id));
            const previousFranchises = new Set(
                groupFranchises(catalog)
                    .filter(matchesActiveFilters)
                    .map(anime => franchiseKey(anime.title)),
            );

            let cursor = offset;
            const fresh: Anime[] = [];
            let addedCards = 0;

            for (let attempt = 0; attempt < 5 && addedCards < 12; attempt += 1) {
                const page = await fetchCatalogPage({limit: 48, offset: cursor});
                const pageFresh: Anime[] = [];

                for (const anime of page) {
                    if (existingIds.has(anime.anime_id)) continue;
                    existingIds.add(anime.anime_id);
                    fresh.push(anime);
                    pageFresh.push(anime);
                }

                if (pageFresh.length) {
                    setCatalog(current => uniqueAnime([...current, ...pageFresh]));
                }

                cursor += page.length;
                addedCards = groupFranchises([...catalog, ...fresh])
                    .filter(matchesActiveFilters)
                    .filter(anime => !previousFranchises.has(franchiseKey(anime.title)))
                    .length;

                if (page.length < 48) break;
                if (addedCards < 12) {
                    await new Promise(resolve => setTimeout(resolve, 120));
                }
            }

            setCatalog(current => uniqueAnime([...current, ...fresh]));
            setOffset(cursor);
            if (fresh.length) {
                const nextPage = Math.min(catalogPageRef.current + 1, 10);
                catalogPageRef.current = nextPage;
                const url = new URL(window.location.href);
                url.searchParams.set("page", String(nextPage));
                window.history.pushState({}, "", url.pathname + url.search);
            } else {
                setError("Больше новых аниме в каталоге не найдено");
            }
        } catch (loadError) {
            setError(loadError instanceof Error
                ? loadError.message
                : "Не удалось загрузить новые аниме");
        } finally {
            setLoading(false);
        }
    }

    function matchesActiveFilters(anime: Anime) {
        const familyCount = anime.franchiseCount ?? 1;


        return (
            (genre === "Все" || anime.genres?.some(item => item.title === genre))
            && (!yearFrom || (anime.year ?? 0) >= Number(yearFrom))
            && (!yearTo || (anime.year ?? 9999) <= Number(yearTo))
            && (
                groupFilter === "all"
                || (groupFilter === "franchise" ? familyCount > 1 : familyCount === 1)
            )
            && (
                formatFilter === "all"
                || animeFormat(anime) === formatFilter
            )
            && (statusFilter === "all" || releaseStatus(anime).kind === statusFilter)
        );
    }

    useEffect(() => {
        if (view === "catalog" && !active && !catalogReady) {
            void loadLatestRef.current(0, false, new URLSearchParams(window.location.search).get("q") ?? "");
        }
    }, [view, active, catalogReady]);

    const storedIds = useMemo(
        () => Array.from(new Set([
            ...favorites,
            ...folders.flatMap(folder => folder.animeIds),
            ...Object.keys(progress).map(Number),
            ...Object.keys(ratings).map(Number),
        ])),
        [favorites, folders, progress, ratings],
    );

    useEffect(() => {
        if (active) return;

        const missing = storedIds.filter(
            animeId => !catalog.some(anime => anime.anime_id === animeId),
        );
        if (!missing.length) return;

        fetchAnimeDetails(missing)
            .then(anime => {
                setCatalog(current => uniqueAnime([...current, ...anime]));
            })
            .catch(() => undefined);
    }, [storedIds.join(","), catalog.length, active]);

    const idsNeedingStats = useMemo(
        () => storedIds.filter(
            animeId => !((progress[animeId]?.totalEpisodes ?? 0) > 0),
        ),
        [storedIds, progress],
    );

    useEffect(() => {
        if (view !== "home" || active || !idsNeedingStats.length) return;

        let cancelled = false;

        async function hydrateEpisodeStatistics() {
            const rows: Array<readonly [number, number, number]> = [];

            for (const animeId of idsNeedingStats) {
                if (cancelled) break;

                try {
                    const videos = await fetchAnimeVideos(animeId);
                    const uniqueVideos = uniqueVideosByNumber(videos);
                    const totalDuration = uniqueVideos.reduce(
                        (sum, video) => sum + (video.duration ?? 0),
                        0,
                    );
                    rows.push([animeId, uniqueVideos.length, totalDuration]);
                } catch {
                    // A missing video list must not block the rest of the library.
                }

                await new Promise(resolve => setTimeout(resolve, 180));
            }

            if (cancelled || !rows.length) return;

            setProgress(current => {
                const next = {...current};

                for (const [animeId, totalEpisodes, totalDuration] of rows) {
                    const existing = next[animeId];
                    next[animeId] = {
                        ...existing,
                        title: existing?.title
                            ?? catalog.find(anime => anime.anime_id === animeId)?.title,
                        episode: existing?.episode ?? "1",
                        dub: existing?.dub ?? "",
                        season: existing?.season ?? 1,
                        episodes: existing?.episodes ?? {},
                        totalEpisodes,
                        totalDuration,
                    };
                }

                write(K.progress, next);
                return next;
            });
        }

        const idleWindow = window as typeof window & {
            requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
            cancelIdleCallback?: (handle: number) => void;
        };
        const idleHandle = idleWindow.requestIdleCallback?.(
            () => void hydrateEpisodeStatistics(),
            {timeout: 1800},
        );
        const fallbackTimer = idleHandle === undefined
            ? window.setTimeout(() => void hydrateEpisodeStatistics(), 900)
            : undefined;
        return () => {
            cancelled = true;
            if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
            if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
        };
    }, [idsNeedingStats.join(","), view, active]);

    const combinedCatalog = useMemo(() => uniqueAnime([...catalog, ...ongoing.items]), [catalog, ongoing.items]);
    return {
        ongoing,
        active,
        catalog: combinedCatalog,
        error,
        dubbingFilter,
        formatFilter,
        statusFilter,
        genre,
        groupFilter,
        loading,
        newEpisodeRequested,
        query,
        randomGenre,
        randomOpen,
        randomRating,
        randomYearFrom,
        randomYearTo,
        ratingFrom,
        ratingSource,
        resumeRequested,
        sort,
        storedIds,
        view,
        yearFrom,
        yearTo,
        load,
        loadMore,
        setActive,
        setCatalog,
        setDubbingFilter,
        setFormatFilter,
        setStatusFilter,
        setGenre,
        setGroupFilter,
        setNewEpisodeRequested,
        setQuery,
        setRandomGenre,
        setRandomOpen,
        setRandomRating,
        setRandomYearFrom,
        setRandomYearTo,
        setRatingFrom,
        setRatingSource,
        setResumeRequested,
        setSort,
        setView,
        setYearFrom,
        setYearTo,
    };
}

function uniqueAnime(anime: Anime[]) {
    return [...new Map(anime.map(item => [item.anime_id, item])).values()];
}

function uniqueVideosByNumber(videos: Video[]) {
    return [...new Map(videos.map(video => [video.number, video])).values()];
}
