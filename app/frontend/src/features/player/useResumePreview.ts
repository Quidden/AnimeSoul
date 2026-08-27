import { useEffect, useMemo, useState } from "react";

import {
    fetchAnimeDetails,
    fetchAnimeTrailers,
    fetchAnimeVideos,
} from "../catalog/api";
import {
    episodeResumePosition,
    latestResumePoint,
    resolveResumeAnime,
} from "../../lib/anime";
import type {
    Anime,
    HeroTrailer,
    PlayerPrefs,
    Progress,
    Video,
} from "../../lib/types";

interface ResumePreviewOptions {
    catalog: Anime[];
    playerPrefs: PlayerPrefs;
    progress: Progress;
}

/** Resolves the last playable episode and its optional home-page preview. */
export function useResumePreview({
    catalog,
    playerPrefs,
    progress,
}: ResumePreviewOptions) {
    const [previewAnime, setPreviewAnime] = useState<Anime | null>(null);
    const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
    const [trailer, setTrailer] = useState<HeroTrailer | null>(null);

    const last = useMemo(
        () => Object.entries(progress)
            .map(([animeId, item]) => ({
                animeId,
                item,
                point: latestResumePoint(item),
            }))
            .filter(entry =>
                entry.point
                && episodeResumePosition(entry.point.state) > 0,
            )
            .sort((left, right) =>
                (right.point?.state.updatedAt ?? 0)
                - (left.point?.state.updatedAt ?? 0),
            )[0],
        [progress],
    );
    const lastAnimeId = last ? Number(last.animeId) : undefined;
    const lastAnime = resolveResumeAnime(catalog, lastAnimeId, last?.item.title);
    const lastState = last?.item;
    const lastPoint = useMemo(
        () => latestResumePoint(lastState),
        [lastState],
    );
    const lastDisplayEpisode = resolveDisplayEpisode(lastState?.episode, lastPoint?.episode);

    useEffect(() => {
        if (!lastAnime || !playerPrefs.homeEpisodePreview) {
            setPreviewAnime(null);
            return;
        }

        let cancelled = false;
        fetchAnimeDetails([lastPoint?.state.originAnimeId ?? lastState?.originAnimeId ?? lastAnime.anime_id])
            .then(anime => {
                if (!cancelled) setPreviewAnime(anime[0] ?? lastAnime);
            })
            .catch(() => {
                if (!cancelled) setPreviewAnime(lastAnime);
            });

        return () => {
            cancelled = true;
        };
    }, [
        lastAnime?.anime_id,
        lastPoint?.state.originAnimeId,
        lastState?.originAnimeId,
        playerPrefs.homeEpisodePreview,
    ]);

    useEffect(() => {
        const videoPreviewEnabled = playerPrefs.homeEpisodePreview
            && playerPrefs.homePreviewMode === "screenshots";
        if (!lastAnimeId || !videoPreviewEnabled) {
            setTrailer(null);
            return;
        }

        let cancelled = false;
        const seasonAnimeId = lastPoint?.state.originAnimeId ?? lastState?.originAnimeId ?? lastAnimeId;
        setTrailer(null);

        const loadTrailer = async () => {
            try {
                const seasonTrailers = await fetchAnimeTrailers(seasonAnimeId);
                if (cancelled) return;
                if (seasonTrailers[0]) {
                    setTrailer(seasonTrailers[0]);
                    return;
                }

                if (seasonAnimeId !== lastAnimeId) {
                    const animeTrailers = await fetchAnimeTrailers(lastAnimeId);
                    if (!cancelled) setTrailer(animeTrailers[0] ?? null);
                    return;
                }
                setTrailer(null);
            } catch {
                if (!cancelled) setTrailer(null);
            }
        };

        void loadTrailer();
        return () => {
            cancelled = true;
        };
    }, [
        lastAnimeId,
        lastPoint?.state.originAnimeId,
        lastState?.originAnimeId,
        playerPrefs.homeEpisodePreview,
        playerPrefs.homePreviewMode,
    ]);

    useEffect(() => {
        const screenshotsEnabled = playerPrefs.homeEpisodePreview
            && playerPrefs.homePreviewMode === "screenshots";
        if (!lastAnime || !lastState || !lastPoint || !screenshotsEnabled) {
            setPreviewVideo(null);
            return;
        }

        let cancelled = false;
        fetchAnimeVideos(lastPoint.state.originAnimeId ?? lastState.originAnimeId ?? lastAnime.anime_id)
            .then(videos => {
                if (cancelled) return;

                const episodeNumber = lastPoint.state.originEpisode ?? lastState.originEpisode ?? lastPoint.episode;
                const episodeVideos = videos.filter(
                    video => video.number === episodeNumber,
                );
                setPreviewVideo(selectPreviewVideo(episodeVideos, lastPoint.state.dub ?? lastState.dub));
            })
            .catch(() => {
                if (!cancelled) setPreviewVideo(null);
            });

        return () => {
            cancelled = true;
        };
    }, [
        lastAnime?.anime_id,
        lastPoint?.episode,
        lastPoint?.state.dub,
        lastPoint?.state.originAnimeId,
        lastPoint?.state.originEpisode,
        lastState?.dub,
        lastState?.originAnimeId,
        lastState?.originEpisode,
        playerPrefs.homeEpisodePreview,
        playerPrefs.homePreviewMode,
    ]);

    return {
        heroPreviewAnime: previewAnime,
        heroPreviewVideo: previewVideo,
        heroTrailer: trailer,
        last,
        lastAnime,
        lastDisplayEpisode,
        lastPoint,
        lastState,
    };
}

function resolveDisplayEpisode(
    stateEpisode: string | undefined,
    pointEpisode: string | undefined,
) {
    if (pointEpisode && Number(pointEpisode) > 0) return pointEpisode;
    if (stateEpisode && Number(stateEpisode) > 0) return stateEpisode;
    return "1";
}

function selectPreviewVideo(videos: Video[], dubbing: string) {
    return videos.find(video =>
        video.data.dubbing === dubbing && /kodik/i.test(video.data.player),
    )
        ?? videos.find(video => /kodik/i.test(video.data.player))
        ?? videos[0]
        ?? null;
}
