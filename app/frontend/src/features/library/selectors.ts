import {isEpisodeWatched, isExtraAnime, isMovieAnime} from "../../lib/anime";
import type {Anime, AnimeProgress, EpisodeState, Folder, Progress} from "../../lib/types";
import type {AnimeStatistics, StatisticsActivityEntry} from "../../pages/StatisticsPage";

/** One playback event shown in the optional history section. */
export type HistoryItem = {
    animeId: number;
    season: number;
    episode: string;
    state: EpisodeState;
};

/** Latest unfinished episode for one anime title. */
export type WatchingItem = {
    animeId: number;
    item: AnimeProgress;
    season: number;
    episode: string;
    state: EpisodeState;
    updatedAt: number;
};

export type CollectionProgress = {
    total: number;
    watched: number;
    percent: number;
};

export function selectHistoryItems(
    progress: Progress,
    enabled: boolean,
    clearedAt: number,
    limit = 30,
): HistoryItem[] {
    if (!enabled) return [];

    return Object.entries(progress)
        .flatMap(([animeId, item]) => Object.entries(item.episodes)
            .filter(([, state]) => state.updatedAt > clearedAt)
            .map(([key, state]) => {
                const [season, episode] = key.split(":");
                return {
                    animeId: Number(animeId),
                    season: Number(season) || 1,
                    episode,
                    state,
                };
            }))
        .sort((left, right) => right.state.updatedAt - left.state.updatedAt)
        .slice(0, limit);
}

export function selectWatchingItems(progress: Progress, hiddenAnimeIds: number[]): WatchingItem[] {
    const hidden = new Set(hiddenAnimeIds);

    return Object.entries(progress)
        .flatMap(([animeId, item]) => {
            const id = Number(animeId);
            const episodes = Object.entries(item.episodes);
            if (!episodes.length || hidden.has(id)) return [];

            const watched = episodes.filter(([, state]) => isEpisodeWatched(state)).length;
            if (item.totalEpisodes && watched >= item.totalEpisodes) return [];

            const [lastKey, state] = [...episodes]
                .sort((left, right) => right[1].updatedAt - left[1].updatedAt)[0];
            const [season, episode] = lastKey.split(":");
            return [{
                animeId: id,
                item,
                season: Number(season) || item.season || 1,
                episode,
                state,
                updatedAt: state.updatedAt,
            }];
        })
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function calculateAnimeProgress(item?: AnimeProgress): number {
    if (!item?.totalEpisodes) return 0;
    const watched = Object.values(item.episodes).filter(isEpisodeWatched).length;
    return Math.min(100, Math.round((watched / item.totalEpisodes) * 100));
}

export function calculateFolderProgress(folder: Folder, progress: Progress): CollectionProgress {
    const total = folder.animeIds.reduce(
        (sum, animeId) => sum + (progress[animeId]?.totalEpisodes ?? 0),
        0,
    );
    const watched = folder.animeIds.reduce((sum, animeId) => {
        const watchedEpisodeKeys = Object.entries(progress[animeId]?.episodes ?? {})
            .filter(([, state]) => isEpisodeWatched(state))
            .map(([key]) => key);
        return sum + new Set(watchedEpisodeKeys).size;
    }, 0);

    return {
        total,
        watched,
        percent: total ? Math.min(100, Math.round((watched / total) * 100)) : 0,
    };
}

/**
 * Derives every statistics counter from progress in one deterministic pass.
 * Keeping this pure prevents UI refactors from silently changing accounting.
 */
export function calculateAnimeStatistics(
    progress: Progress,
    resolveAnime: (animeId: number) => Anime | undefined,
): AnimeStatistics {
    let series = 0;
    let movies = 0;
    let specials = 0;
    let titles = 0;
    let totalSeconds = 0;
    const genres = new Map<string, number>();
    const rewatches: AnimeStatistics["mostRewatched"] = [];
    const activity: StatisticsActivityEntry[] = [];

    for (const [idText, item] of Object.entries(progress)) {
        const animeId = Number(idText);
        const anime = resolveAnime(animeId);
        const episodeEntries = Object.entries(item.episodes);
        const states = episodeEntries.map(([, state]) => state);
        const completed = states.filter(isEpisodeWatched);
        const completionCount = states.reduce(
            (sum, state) => sum + (state.completions ?? (isEpisodeWatched(state) ? 1 : 0)),
            0,
        );
        const rewatchCount = Math.max(0, completionCount - completed.length);

        totalSeconds += states.reduce(
            (sum, state) => sum + (state.watchedSeconds ?? Math.min(state.position, state.duration || state.position)),
            0,
        );
        if (anime && isMovieAnime(anime)) movies += completionCount;
        else if (anime && isExtraAnime(anime)) specials += completionCount;
        else series += completionCount;

        if (completed.length && (item.totalEpisodes ? completed.length >= item.totalEpisodes : true)) titles++;
        for (const genre of anime?.genres ?? []) {
            genres.set(genre.title, (genres.get(genre.title) ?? 0) + completed.length);
        }
        if (rewatchCount > 0) {
            rewatches.push({animeId, title: anime?.title ?? `Аниме #${animeId}`, count: rewatchCount});
        }

        for (const [episodeKey, state] of episodeEntries) {
            if (!isEpisodeWatched(state)) continue;
            const separator = episodeKey.indexOf(":");
            const season = Number(episodeKey.slice(0, separator)) || item.season || 1;
            const episode = separator >= 0 ? episodeKey.slice(separator + 1) : episodeKey;
            const timestamps = state.completionHistory?.length
                ? state.completionHistory
                : Array.from({length: Math.max(1, state.completions ?? 1)}, () => state.updatedAt);

            for (const timestamp of timestamps) {
                activity.push({
                    timestamp,
                    animeId,
                    title: anime?.title ?? `Аниме #${animeId}`,
                    season,
                    episode,
                    duration: state.duration || 0,
                });
            }
        }
    }

    return {
        series,
        movies,
        specials,
        titles,
        totalSeconds,
        activity: activity.sort((left, right) => right.timestamp - left.timestamp),
        favoriteGenres: [...genres.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8),
        mostRewatched: rewatches.sort((left, right) => right.count - left.count).slice(0, 6),
    };
}
