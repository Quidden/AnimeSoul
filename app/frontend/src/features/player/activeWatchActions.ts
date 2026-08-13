import type { Dispatch, SetStateAction } from "react";

import { STORAGE_KEYS } from "../../lib/settings";
import { writeLocal } from "../../lib/storage";
import type { Anime, AnimeProgress, Tracker } from "../../lib/types";
import { isEpisodeWatched } from "../../lib/anime";
import { acknowledgeTrackedEpisode } from "../../lib/tracking";

type ActiveWatchActionsOptions = {
    anime: Anime;
    tracker?: Tracker;
    tracked: Tracker[];
    setProgress: Dispatch<SetStateAction<Record<number, AnimeProgress>>>;
    setTracked: Dispatch<SetStateAction<Tracker[]>>;
    saveTracked: (trackers: Tracker[]) => void;
};

/**
 * Keeps progress persistence and tracking acknowledgement out of the page shell.
 * The two updates intentionally remain coupled: completing an episode may also
 * acknowledge the matching "new episode" marker.
 */
export function createActiveWatchActions({
    anime,
    tracker,
    tracked,
    setProgress,
    setTracked,
    saveTracked,
}: ActiveWatchActionsOptions) {
    const updateProgress = (
        value: AnimeProgress,
        originEpisodeKey?: string | string[],
        changedEpisodeKey?: string | string[],
    ) => {
        const changedKeys = Array.isArray(changedEpisodeKey)
            ? changedEpisodeKey
            : [changedEpisodeKey ?? `${value.season ?? 1}:${value.episode}`];
        const originKeys = Array.isArray(originEpisodeKey)
            ? originEpisodeKey
            : originEpisodeKey ? [originEpisodeKey] : [];

        setProgress(current => {
            const previousEpisodes = current[anime.anime_id]?.episodes;
            const newlyWatched = changedKeys.some(key => (
                !isEpisodeWatched(previousEpisodes?.[key])
                && isEpisodeWatched(value.episodes[key])
            ));
            const next = {
                ...current,
                [anime.anime_id]: {
                    ...value,
                    // Readable metadata only; the anime ID remains the storage key.
                    title: anime.title,
                },
            };
            writeLocal(STORAGE_KEYS.progress, next);

            if (tracker && originKeys.length && newlyWatched) {
                setTracked(currentTracked => {
                    const nextTracked = currentTracked.map(item => (
                        item.animeId === tracker.animeId
                            ? originKeys.reduce(acknowledgeTrackedEpisode, item)
                            : item
                    ));
                    writeLocal(STORAGE_KEYS.tracked, nextTracked);
                    return nextTracked;
                });
            }
            return next;
        });
    };

    const saveTracker = (
        count: number,
        dubs: string[],
        animeIds: number[],
        title: string,
        knownKeys: string[],
    ) => {
        const otherTrackers = tracked.filter(
            item => item.animeId !== tracker?.animeId,
        );
        saveTracked([...otherTrackers, {
            animeId: animeIds[0] ?? anime.anime_id,
            animeIds,
            title,
            knownEpisodes: count,
            knownEpisodeKeys: knownKeys,
            pendingEpisodeKeys: [],
            newEpisodes: 0,
            knownAnyEpisodeKeys: dubs.length ? undefined : knownKeys,
            pendingOtherDubEpisodeKeys: [],
            otherDubEpisodes: 0,
            dubs,
            lastCheckedAt: Date.now(),
        }]);
    };

    const removeTracker = () => {
        saveTracked(tracked.filter(item => item.animeId !== tracker?.animeId));
    };

    return {removeTracker, saveTracker, updateProgress};
}
