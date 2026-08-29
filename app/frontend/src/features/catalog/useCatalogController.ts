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
    isMovieAnime,
} from "../../lib/anime";
import { writeLocal as write } from "../../lib/storage";
import {
    fetchAnimeDetails,
    fetchAnimeVideos,
    fetchCatalogPage,
    prefetchCatalogSearch,
} from "./api";

export type ApplicationView = "home" | "catalog" | "stats" | "ratings" | "downloads";

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
    const [view, setView] = useState<ApplicationView>("home");

    const [query, setQuery] = useState("");
    const [genre, setGenre] = useState("Все");
    const [sort, setSort] = useState("rating-desc");
    const [yearFrom, setYearFrom] = useState("");
    const [yearTo, setYearTo] = useState("");
    const [groupFilter, setGroupFilter] = useState("all");
    const [formatFilter, setFormatFilter] = useState("all");
    const [dubbingFilter, setDubbingFilter] = useState("all");
    const [ratingSource, setRatingSource] = useState("average");
    const [ratingFrom, setRatingFrom] = useState("");

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

    useEffect(() => {
        if (active) setView("catalog");
    }, [active]);

    async function load(next = 0, append = false, search = query) {
        const requestId = ++loadRequestRef.current;
        setCatalogReady(true);
        setLoading(true);
        setError("");

        try {
            const anime = await fetchCatalogPage({
                limit: 24,
                offset: next,
                query: search,
            });

            if (requestId !== loadRequestRef.current) return;
            setCatalog(current => {
                if (append) return uniqueAnime([...current, ...anime]);
                if (search.trim()) return uniqueAnime([...anime, ...current]);
                return anime;
            });
            if (!search.trim()) setOffset(next + anime.length);
        } catch (loadError) {
            if (requestId !== loadRequestRef.current) return;
            setError(loadError instanceof Error
                ? loadError.message
                : "Ошибка каталога");
        } finally {
            if (requestId === loadRequestRef.current) setLoading(false);
        }
    }

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
            if (!fresh.length) {
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
        const movie = isMovieAnime(anime);

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
                || (formatFilter === "movie" ? movie : !movie)
            )
        );
    }

    useEffect(() => {
        if (view === "catalog" && !active && !catalogReady) {
            void load(0, false, "");
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

    return {
        active,
        catalog,
        error,
        dubbingFilter,
        formatFilter,
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
