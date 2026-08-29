import {useCallback, useEffect, useMemo, useState} from "react";

import {
    fetchDownloadJobs,
    fetchOfflineAnime,
    fetchOfflineLibrary,
    fetchOfflineSettings,
    hasOfflineAnimeLookup,
    hasKodikSecretAccess,
    KODIK_ACCESS_CHANGED_EVENT,
    peekOfflineAnime,
    type DownloadJob,
    type OfflineAnime,
} from "../../lib/downloads";
import type {Anime, Video} from "../../lib/types";

const ACTIVE_DOWNLOAD_STATUSES = new Set(["queued", "downloading", "paused"]);

/** Owns local-library discovery, active-download polling and offline video mapping. */
export function useOfflinePlayback(anime: Anime) {
    const [offlineAnime, setOfflineAnime] = useState<OfflineAnime | null>(() => (
        peekOfflineAnime(anime.anime_id)
    ));
    const [offlineLookupReady, setOfflineLookupReady] = useState(() => (
        hasOfflineAnimeLookup(anime.anime_id)
    ));
    const [localPlaybackReady, setLocalPlaybackReady] = useState(false);
    const [kodikAccessReady, setKodikAccessReady] = useState(false);
    const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);

    const initialLookupStatus = peekOfflineAnime(anime.anime_id)
        ? ""
        : hasOfflineAnimeLookup(anime.anime_id)
            ? "Загружаем серии…"
            : "Проверяем скачанные серии…";

    useEffect(() => {
        setOfflineAnime(peekOfflineAnime(anime.anime_id));
        setOfflineLookupReady(hasOfflineAnimeLookup(anime.anime_id));
        setLocalPlaybackReady(false);
        setDownloadJobs([]);
    }, [anime.anime_id]);

    useEffect(() => {
        let stopped = false;
        fetchDownloadJobs()
            .then(jobs => {
                if (!stopped) setDownloadJobs(jobs.filter(job => job.animeId === anime.anime_id));
            })
            .catch(() => undefined);
        fetchOfflineAnime(anime.anime_id)
            .then(item => {
                if (!stopped) setOfflineAnime(item);
            })
            .catch(() => {
                // A failed local lookup must not discard a previously cached title.
            })
            .finally(() => {
                if (!stopped) setOfflineLookupReady(true);
            });
        return () => {
            stopped = true;
        };
    }, [anime.anime_id]);

    const activeDownloadKey = useMemo(() => downloadJobs
        .filter(job => ACTIVE_DOWNLOAD_STATUSES.has(job.status))
        .map(job => `${job.id}:${job.status}`)
        .join("|"), [downloadJobs]);

    useEffect(() => {
        if (!activeDownloadKey) return;

        let stopped = false;
        const refresh = () => {
            void fetchOfflineLibrary().then(library => {
                if (stopped) return;
                setOfflineAnime(library.anime.find(item => item.animeId === anime.anime_id) ?? null);
                setDownloadJobs(library.jobs.filter(job => job.animeId === anime.anime_id));
            }).catch(() => undefined);
        };
        refresh();
        const timer = window.setInterval(refresh, 750);
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [activeDownloadKey, anime.anime_id]);

    useEffect(() => {
        let stopped = false;
        const refreshAccess = () => {
            fetchOfflineSettings()
                .then(settings => {
                    if (!stopped) setKodikAccessReady(hasKodikSecretAccess(settings));
                })
                .catch(() => {
                    if (!stopped) setKodikAccessReady(false);
                });
        };
        refreshAccess();
        window.addEventListener(KODIK_ACCESS_CHANGED_EVENT, refreshAccess);
        const timer = window.setInterval(refreshAccess, 3_000);
        return () => {
            stopped = true;
            window.removeEventListener(KODIK_ACCESS_CHANGED_EVENT, refreshAccess);
            window.clearInterval(timer);
        };
    }, []);

    const offlineVideosBySeason = useMemo(() => {
        const grouped: Record<number, Video[]> = {};
        for (const [index, item] of (offlineAnime?.episodes ?? []).entries()) {
            const season = item.season;
            const list = grouped[season] ?? [];
            list.push({
                video_id: -(season * 100_000 + index + 1),
                iframe_url: item.mediaUrl,
                number: item.episode,
                duration: item.duration,
                originAnimeId: item.originAnimeId ?? anime.anime_id,
                originNumber: item.originEpisode ?? item.episode,
                contentKind: "Серия",
                contentTitle: anime.title,
                data: {
                    dubbing: item.dubbing,
                    player: `Локальный файл · ${item.quality}p`,
                    translation_id: item.translationId,
                },
                skips: item.skips,
                offline: {
                    episodeId: item.id,
                    quality: item.quality,
                    mediaUrl: item.mediaUrl,
                    mediaType: item.mediaType,
                    previewUrl: item.previewUrl,
                    skips: item.skips,
                },
            });
            grouped[season] = list;
        }
        return grouped;
    }, [anime.anime_id, anime.title, offlineAnime]);

    const offlineVideosKey = useMemo(() => Object.values(offlineVideosBySeason)
        .flat()
        .map(video => `${video.offline?.episodeId}:${video.offline?.quality}`)
        .join("|"), [offlineVideosBySeason]);

    const mergeOfflineVideos = useCallback((remote: Record<number, Video[]>) => {
        const result: Record<number, Video[]> = {};
        const seasons = new Set([
            ...Object.keys(remote),
            ...Object.keys(offlineVideosBySeason),
        ].map(Number));
        for (const season of seasons) {
            const online = (remote[season] ?? []).filter(video => !video.offline);
            result[season] = [...online, ...(offlineVideosBySeason[season] ?? [])];
        }
        return result;
    }, [offlineVideosBySeason]);

    useEffect(() => {
        if (!offlineVideosKey || localPlaybackReady) return;
        // A damaged or externally removed file must not prevent online fallback forever.
        const timer = window.setTimeout(() => setLocalPlaybackReady(true), 8_000);
        return () => window.clearTimeout(timer);
    }, [localPlaybackReady, offlineVideosKey]);

    return {
        downloadJobs,
        initialLookupStatus,
        kodikAccessReady,
        localPlaybackReady,
        mergeOfflineVideos,
        offlineAnime,
        offlineLookupReady,
        offlineVideosBySeason,
        offlineVideosKey,
        setDownloadJobs,
        setLocalPlaybackReady,
    };
}
