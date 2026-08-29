import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    animeSearchScore,
    fetchFamily,
    franchiseName,
    groupFranchises,
    isExtraAnime,
    isMovieAnime,
    matchesAnimeSearch,
    releaseStatus,
    stripPart,
} from "../../lib/anime";
import { animeApiRatings, ratingForSource, sourceLabel } from "../../lib/ratings";
import type { Anime, CardMeta, CommunityRatings, UserRatings } from "../../lib/types";
import { fetchAnimeVideos } from "./api";
import type { ApplicationView } from "./useCatalogController";

interface CatalogPresentationOptions {
    active: Anime | null;
    catalog: Anime[];
    formatFilter: string;
    dubbingFilter: string;
    genre: string;
    groupFilter: string;
    query: string;
    randomGenre: string;
    randomRating: string;
    randomYearFrom: string;
    randomYearTo: string;
    ratingFrom: string;
    ratingSource: string;
    ratings: UserRatings;
    communityRatings: CommunityRatings;
    sort: string;
    storedIds: number[];
    view: ApplicationView;
    yearFrom: string;
    yearTo: string;
}

/**
 * Builds the display-only catalog model: franchise cards, filters and remote
 * metadata. Navigation and pagination remain in useCatalogController.
 */
export function useCatalogPresentation(options: CatalogPresentationOptions) {
    const {
        active,
        catalog,
        formatFilter,
        dubbingFilter,
        genre,
        groupFilter,
        query,
        randomGenre,
        randomRating,
        randomYearFrom,
        randomYearTo,
        ratingFrom,
        ratingSource,
        sort,
        storedIds,
        view,
        yearFrom,
        yearTo,
    } = options;
    const [cardMeta, setCardMeta] = useState<Record<number, CardMeta>>({});
    const requestedMetadata = useRef(new Set<number>());

    const genres = useMemo(
        () => [
            "Все",
            ...Array.from(new Set(
                catalog.flatMap(anime =>
                    anime.genres?.map(item => item.title) ?? [],
                ),
            )).slice(0, 14),
        ],
        [catalog],
    );

    const searchedCatalog = useMemo(
        () => query.trim()
            ? catalog.filter(anime => matchesAnimeSearch(anime, query))
            : catalog,
        [catalog, query],
    );

    const franchises = useMemo(() => {
        const grouped = groupFranchises(searchedCatalog);
        if (!query.trim()) return grouped;

        return grouped.sort(
            (left, right) =>
                animeSearchScore(right, query) - animeSearchScore(left, query),
        );
    }, [searchedCatalog, query]);

    const visible = useMemo(
        () => franchises
            .filter(anime => matchesCatalogFilters(anime, cardMeta, options))
            .sort((left, right) => compareCatalogAnime(left, right, sort)),
        [
            cardMeta,
            formatFilter,
            dubbingFilter,
            franchises,
            genre,
            groupFilter,
            ratingFrom,
            ratingSource,
            options.ratings,
            options.communityRatings,
            sort,
            yearFrom,
            yearTo,
        ],
    );

    const randomCandidates = useMemo(
        () => franchises.filter(anime => matchesRandomFilters(anime, options)),
        [
            franchises,
            randomGenre,
            randomRating,
            randomYearFrom,
            randomYearTo,
        ],
    );

    const ratingSources = useMemo(() => {
        const apiKeys = new Set(franchises.flatMap(anime => animeApiRatings(anime).map(source => source.key)));
        const fixed = [
            { key: "user", label: "Моя оценка" },
            { key: "calculated", label: "Средняя по сезонам" },
            { key: "animesoul", label: "AnimeSoul" },
        ];
        return [
            ...fixed,
            ...[...apiKeys].map(key => ({ key, label: sourceLabel(key) })),
        ];
    }, [franchises]);

    const dubbings = useMemo(() => [
        "all",
        ...Array.from(new Set(Object.values(cardMeta).flatMap(meta => meta.dubbings ?? [])))
            .sort((left, right) => left.localeCompare(right, "ru")),
    ], [cardMeta]);

    useEffect(() => {
        if (active) return;

        const allowed = view === "catalog"
            ? dubbingFilter === "all" ? [] : franchises
            : franchises.filter(anime => storedIds.includes(anime.anime_id));
        const targets = allowed.filter(anime => !cardMeta[anime.anime_id]);
        if (!targets.length) return;

        let cancelled = false;
        void loadMissingCardMetadata(targets, cancelledMeta => {
            if (!cancelled) {
                setCardMeta(current => ({ ...current, ...cancelledMeta }));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        active,
        dubbingFilter,
        franchises.map(anime => anime.anime_id).join(","),
        storedIds.join(","),
        view,
    ]);

    const requestCardMeta = useCallback((anime: Anime) => {
        if (cardMeta[anime.anime_id] || requestedMetadata.current.has(anime.anime_id)) return;
        requestedMetadata.current.add(anime.anime_id);
        void scheduleCardMetadata(anime)
            .then(metadata => {
                setCardMeta(current => ({ ...current, ...metadata }));
            })
            .catch(() => undefined)
            .finally(() => {
                requestedMetadata.current.delete(anime.anime_id);
            });
    }, [cardMeta]);

    return {
        cardMeta,
        dubbings,
        franchises,
        genres,
        randomCandidates,
        ratingSources,
        requestCardMeta,
        visible,
    };
}

function matchesCatalogFilters(
    anime: Anime,
    cardMeta: Record<number, CardMeta>,
    options: CatalogPresentationOptions,
) {
    const meta = cardMeta[anime.anime_id];
    const familyCount = meta?.familyCount ?? anime.franchiseCount ?? 1;
    const movie = isMovieAnime(anime);
    const matchesGenre = options.genre === "Все"
        || anime.genres?.some(item => item.title === options.genre);
    const matchesStartYear = !options.yearFrom
        || (anime.year ?? 0) >= Number(options.yearFrom);
    const matchesEndYear = !options.yearTo
        || (anime.year ?? 9999) <= Number(options.yearTo);
    const matchesGroup = options.groupFilter === "all"
        || !meta
        || (options.groupFilter === "franchise"
            ? familyCount > 1
            : familyCount === 1);
    const matchesFormat = options.formatFilter === "all"
        || (options.formatFilter === "movie" ? movie : !movie);
    const matchesDubbing = options.dubbingFilter === "all"
        || Boolean(meta?.dubbings.includes(options.dubbingFilter));
    const selectedRating = ratingForSource(
        anime,
        options.ratings[anime.anime_id],
        options.ratingSource,
        options.communityRatings[anime.anime_id],
    );
    const matchesRating = !options.ratingFrom
        || (selectedRating !== undefined && selectedRating >= Number(options.ratingFrom));

    return Boolean(
        matchesGenre
        && matchesStartYear
        && matchesEndYear
        && matchesGroup
        && matchesFormat
        && matchesDubbing
        && matchesRating,
    );
}

function matchesRandomFilters(
    anime: Anime,
    options: CatalogPresentationOptions,
) {
    const matchesGenre = options.randomGenre === "Все"
        || anime.genres?.some(item => item.title === options.randomGenre);
    const matchesStartYear = !options.randomYearFrom
        || (anime.year ?? 0) >= Number(options.randomYearFrom);
    const matchesEndYear = !options.randomYearTo
        || (anime.year ?? 9999) <= Number(options.randomYearTo);
    const matchesRating = (anime.rating?.average ?? 0)
        >= Number(options.randomRating);

    return Boolean(
        matchesGenre
        && matchesStartYear
        && matchesEndYear
        && matchesRating,
    );
}

function compareCatalogAnime(left: Anime, right: Anime, sort: string) {
    switch (sort) {
        case "rating-desc":
            return (right.rating?.average ?? 0) - (left.rating?.average ?? 0);
        case "rating-asc":
            return (left.rating?.average ?? 0) - (right.rating?.average ?? 0);
        case "year-desc":
            return (right.year ?? 0) - (left.year ?? 0);
        case "year-asc":
            return (left.year ?? 0) - (right.year ?? 0);
        default:
            return (right.views ?? 0) - (left.views ?? 0);
    }
}

async function loadMissingCardMetadata(
    animeList: Anime[],
    update: (metadata: Record<number, CardMeta>) => void,
) {
    for (const anime of animeList) {
        try {
            const metadata = await scheduleCardMetadata(anime);
            update(metadata);
        } catch {
            // A single incomplete API entry must not stop the remaining cards.
        }

        await new Promise(resolve => setTimeout(resolve, 120));
    }
}

const CARD_METADATA_CONCURRENCY = 2;
let activeMetadataRequests = 0;
const metadataQueue: Array<{
    anime: Anime;
    resolve: (metadata: Record<number, CardMeta>) => void;
    reject: (error: unknown) => void;
}> = [];
const metadataInflight = new Map<number, Promise<Record<number, CardMeta>>>();

function scheduleCardMetadata(anime: Anime) {
    const existing = metadataInflight.get(anime.anime_id);
    if (existing) return existing;
    const request = new Promise<Record<number, CardMeta>>((resolve, reject) => {
        metadataQueue.push({ anime, resolve, reject });
        pumpMetadataQueue();
    }).finally(() => {
        metadataInflight.delete(anime.anime_id);
    });
    metadataInflight.set(anime.anime_id, request);
    return request;
}

function pumpMetadataQueue() {
    while (activeMetadataRequests < CARD_METADATA_CONCURRENCY && metadataQueue.length) {
        const item = metadataQueue.shift();
        if (!item) return;
        activeMetadataRequests += 1;
        void loadCardMetadata(item.anime)
            .then(item.resolve, item.reject)
            .finally(() => {
                activeMetadataRequests -= 1;
                pumpMetadataQueue();
            });
    }
}

async function loadCardMetadata(anime: Anime) {
    const family = await fetchFamily(anime, franchiseName(anime.title));
    const members = family.length ? family : [anime];
    const movies = members.filter(isMovieAnime);
    const series = members.filter(item =>
        !isMovieAnime(item) && !isExtraAnime(item),
    );
    const arcCount = new Set(series.map(item => stripPart(item.title))).size;
    const numberedSeasons = new Set(
        series
            .map(item => item.season)
            .filter((number): number is number => typeof number === "number"),
    ).size;
    const seasonCount = Math.max(
        arcCount,
        numberedSeasons,
        series.length > 1 ? 2 : series.length,
    );
    const statusSource = members.find(item => releaseStatus(item).kind === "airing")
        ?? members.find(item => releaseStatus(item).kind === "planned")
        ?? anime;
    const memberVideos = await Promise.all(members.map(member =>
        fetchAnimeVideos(member.anime_id).catch(() => []),
    ));
    const videos = memberVideos.flat();
    const uniqueVideos = [
        ...new Map(videos.map(video => [video.number, video])).values(),
    ];
    const durations = uniqueVideos
        .map(video => video.duration ?? 0)
        .filter(Boolean);
    const metadata: CardMeta = {
        familyCount: Math.max(1, seasonCount + movies.length),
        seasonCount,
        movieCount: movies.length,
        episodes: uniqueVideos.length,
        durationMin: durations.length ? Math.min(...durations) : 0,
        durationMax: durations.length ? Math.max(...durations) : 0,
        status: releaseStatus(statusSource),
        dubbings: Array.from(new Set(videos
            .filter(video => {
                const kind = String(video.data.translation_type ?? "").toLocaleLowerCase();
                const title = video.data.dubbing.toLocaleLowerCase();
                return !kind.includes("subtit") && !title.includes("субтит") && !title.includes("subtit");
            })
            .map(video => video.data.dubbing)))
            .sort((left, right) => left.localeCompare(right, "ru")),
    };

    return Object.fromEntries(
        members.map(member => [member.anime_id, metadata]),
    );
}
