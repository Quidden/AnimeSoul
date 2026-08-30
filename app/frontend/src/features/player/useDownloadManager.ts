import {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {episodePreviewImages} from "../../components/EpisodeSlideshow";
import {type DownloadCandidate} from "../downloads/DownloadPicker";
import {
    cancelDownload,
    checkDownloadAvailability,
    enqueueDownload,
    type DownloadJob,
    type OfflineAnime,
} from "../../lib/downloads";
import {isKodikEmbed} from "../../lib/kodik";
import type {KodikStreamInfo} from "../../lib/kodikStream";
import {writeLocal} from "../../lib/storage";
import type {Anime, SeasonGroup, Video} from "../../lib/types";

const DOWNLOAD_QUALITY_KEY = "animesoul:download-quality";
const ACTIVE_DOWNLOAD_STATUSES = new Set(["queued", "downloading", "paused"]);

type UseDownloadManagerOptions = {
    anime: Anime;
    currentDubbing: string;
    directPlaybackKey: string;
    directStreamInfo: {key: string; info: KodikStreamInfo} | null;
    displaySeasons: SeasonGroup[];
    downloadJobs: DownloadJob[];
    downloadQuality: number;
    initialDubbing: string;
    kodikAccessReady: boolean;
    offlineAnime: OfflineAnime | null;
    previewAnimeById: Record<number, Anime>;
    seasonVideos: Record<number, Video[]>;
    setDownloadJobs: Dispatch<SetStateAction<DownloadJob[]>>;
    setDownloadQuality: Dispatch<SetStateAction<number>>;
};

function downloadJobText(job: DownloadJob) {
    const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
    if (job.status === "queued") return `В очереди${job.queuePosition ? ` №${job.queuePosition}` : ""}: ${job.total} сер. · ожидает начала`;
    if (job.status === "paused") return `На паузе: ${job.current || "ожидает разрешённую сеть"}`;
    if (job.status === "downloading") {
        const current = job.current || "Подготавливаем загрузку";
        return `Скачивается: ${current} · ${percent}% · ${Math.min(job.completed + 1, job.total)} из ${job.total}`;
    }
    if (job.status === "completed") return `Готово: скачано ${job.completed || job.total} сер.`;
    if (job.status === "cancelled") return "Загрузка отменена";
    return `Ошибка загрузки: ${job.error || "не удалось получить серию"}`;
}

/** Owns download selection, availability checks, queue submission and cancellation. */
export function useDownloadManager({
    anime,
    currentDubbing,
    directPlaybackKey,
    directStreamInfo,
    displaySeasons,
    downloadJobs,
    downloadQuality,
    initialDubbing,
    kodikAccessReady,
    offlineAnime,
    previewAnimeById,
    seasonVideos,
    setDownloadJobs,
    setDownloadQuality,
}: UseDownloadManagerOptions) {
    const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);
    const [downloadDubbing, setDownloadDubbing] = useState(initialDubbing);
    const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
    const [isCancellingDownload, setIsCancellingDownload] = useState(false);
    const [downloadNotice, setDownloadNotice] = useState("");
    const initialDubbingRef = useRef(initialDubbing);
    initialDubbingRef.current = initialDubbing;

    useEffect(() => {
        setDownloadPickerOpen(false);
        setDownloadDubbing(initialDubbingRef.current);
    }, [anime.anime_id]);

    const downloadDubbings = useMemo(() => Array.from(new Set(
        Object.values(seasonVideos)
            .flat()
            .filter(video => !video.offline && isKodikEmbed(video.iframe_url, video.data.player))
            .map(video => video.data.dubbing),
    )).sort((left, right) => left.localeCompare(right, "ru")), [seasonVideos]);

    const effectiveDownloadDubbing = downloadDubbings.includes(downloadDubbing)
        ? downloadDubbing
        : downloadDubbings.includes(currentDubbing)
            ? currentDubbing
            : downloadDubbings[0] ?? "";

    useEffect(() => {
        if (effectiveDownloadDubbing && effectiveDownloadDubbing !== downloadDubbing) {
            setDownloadDubbing(effectiveDownloadDubbing);
        }
    }, [downloadDubbing, effectiveDownloadDubbing]);

    const downloadVideoChoices = useMemo(() => {
        const selected = new Map<string, Video & {__season: number}>();
        for (const [rawSeason, list] of Object.entries(seasonVideos)) {
            const season = Number(rawSeason);
            for (const video of list) {
                if (
                    video.offline
                    || video.data.dubbing !== effectiveDownloadDubbing
                    || !isKodikEmbed(video.iframe_url, video.data.player)
                ) continue;
                const key = `${season}:${video.number}`;
                const currentChoice = selected.get(key);
                if (!currentChoice || /kodik/i.test(video.data.player)) {
                    selected.set(key, {...video, __season: season});
                }
            }
        }
        return selected;
    }, [effectiveDownloadDubbing, seasonVideos]);

    const activeDownloadJobs = useMemo(() => downloadJobs.filter(
        job => ACTIVE_DOWNLOAD_STATUSES.has(job.status),
    ), [downloadJobs]);

    const downloadEpisodeKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const [rawSeason, list] of Object.entries(seasonVideos)) {
            const season = Number(rawSeason);
            for (const video of list) {
                if (!video.offline && isKodikEmbed(video.iframe_url, video.data.player)) {
                    keys.add(`${season}:${video.number}`);
                }
            }
        }
        return [...keys];
    }, [seasonVideos]);

    const downloadCandidates = useMemo<DownloadCandidate[]>(() => {
        const downloaded = new Set(
            (offlineAnime?.episodes ?? [])
                .filter(item => item.dubbing === effectiveDownloadDubbing && item.quality === downloadQuality)
                .map(item => `${item.season}:${item.episode}`),
        );
        const queued = new Set(
            activeDownloadJobs
                .filter(job => job.quality === downloadQuality)
                .flatMap(job => job.items ?? [])
                .filter(item => item.dubbing === effectiveDownloadDubbing)
                .map(item => `${item.season}:${item.episode}`),
        );
        return downloadEpisodeKeys.map(key => {
            const video = downloadVideoChoices.get(key);
            const separator = key.indexOf(":");
            const season = Number(key.slice(0, separator));
            const group = displaySeasons.find(item => item.number === season);
            const groupTitle = group?.entries.map(item => item.title).join(" / ") ?? "";
            const descriptor = group?.label ?? `Сезон ${season}`;
            const seasonLabel = group?.kind === "season" && groupTitle
                ? `${descriptor} · ${groupTitle}`
                : descriptor;
            return {
                key,
                season,
                seasonLabel,
                episode: video?.number ?? key.slice(separator + 1),
                downloaded: downloaded.has(key),
                queued: queued.has(key),
                missingDubbing: !video,
            };
        });
    }, [activeDownloadJobs, displaySeasons, downloadEpisodeKeys, downloadQuality, downloadVideoChoices, effectiveDownloadDubbing, offlineAnime]);

    const downloadQualityOptions = useMemo(() => {
        const resolved = directStreamInfo?.key === directPlaybackKey && effectiveDownloadDubbing === currentDubbing
            ? directStreamInfo.info.sources.map(source => source.quality)
            : [];
        return [...new Set(resolved.length ? resolved : [360, 480, 720])]
            .filter(value => Number.isFinite(value) && value > 0)
            .sort((left, right) => left - right);
    }, [currentDubbing, directPlaybackKey, directStreamInfo, effectiveDownloadDubbing]);

    const changeDownloadQuality = useCallback((value: number) => {
        setDownloadQuality(value);
        writeLocal(DOWNLOAD_QUALITY_KEY, value);
    }, [setDownloadQuality]);

    useEffect(() => {
        if (!downloadPickerOpen || downloadQualityOptions.includes(downloadQuality)) return;
        const next = [...downloadQualityOptions].reverse().find(value => value <= downloadQuality)
            ?? downloadQualityOptions.at(-1);
        if (next) changeDownloadQuality(next);
    }, [changeDownloadQuality, downloadPickerOpen, downloadQuality, downloadQualityOptions]);

    const queueDownloadVideos = async (
        selectedVideos: (Video & {__season: number})[],
    ): Promise<boolean> => {
        if (!kodikAccessReady) {
            setDownloadNotice("Добавьте публичный и секретный ключи Kodik в настройках офлайн-библиотеки.");
            return false;
        }
        if (isSubmittingDownload) return false;

        const episodes = selectedVideos.map(video => {
            const previewAnime = previewAnimeById[video.originAnimeId ?? anime.anime_id] ?? anime;
            const remoteIds = previewAnime.remote_ids;
            const sourceReference = remoteIds?.shikimori_id
                ? {sourceId: String(remoteIds.shikimori_id), sourceIdType: "shikimori" as const}
                : remoteIds?.kp_id
                    ? {sourceId: String(remoteIds.kp_id), sourceIdType: "kinopoisk" as const}
                    : undefined;
            return {
                videoId: video.video_id,
                season: video.__season,
                seasonLabel: downloadCandidates.find(
                    item => item.key === `${video.__season}:${video.number}`,
                )?.seasonLabel,
                episode: video.number,
                originAnimeId: video.originAnimeId,
                originEpisode: video.originNumber,
                dubbing: video.data.dubbing,
                translationId: video.data.translation_id,
                iframeUrl: video.iframe_url,
                ...sourceReference,
                sourceTitle: previewAnime.title,
                sourceOriginalTitle: previewAnime.original ?? previewAnime.title_en,
                duration: video.duration,
                previewUrl: episodePreviewImages(
                    previewAnime,
                    video.originNumber ?? video.number,
                )[0],
            };
        });
        if (!episodes.length) {
            setDownloadNotice("Для выбранной озвучки пока нет доступных онлайн-серий Kodik.");
            return false;
        }

        try {
            setIsSubmittingDownload(true);
            setDownloadNotice("Проверяем озвучку и качество для каждой выбранной серии…");
            const request = {
                animeId: anime.anime_id,
                title: anime.title,
                year: anime.year,
                posterUrl: anime.poster?.fullsize ?? anime.poster?.big,
                quality: downloadQuality,
                episodes,
            };
            const availability = await checkDownloadAvailability(request);
            if (!availability.available) {
                setDownloadNotice([
                    "Не удалось начать загрузку:",
                    ...availability.issues.map(issue => `• ${issue.message}`),
                ].join("\n"));
                return false;
            }
            setDownloadNotice("Проверка пройдена. Добавляем серии в очередь…");
            const job = await enqueueDownload(request);
            setDownloadJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
            setDownloadNotice(`Добавлено в очередь: ${job.total} сер. Можно выбрать следующий сезон.`);
            return true;
        } catch (error) {
            setDownloadNotice(error instanceof Error
                ? error.message
                : "Не удалось добавить загрузку в очередь.");
            return false;
        } finally {
            setIsSubmittingDownload(false);
        }
    };

    const requestSelectedDownloads = async (keys: string[]) => {
        const missing = keys.filter(key => !downloadVideoChoices.has(key));
        if (missing.length) {
            setDownloadNotice([
                "Не удалось начать загрузку:",
                ...missing.map(key => {
                    const separator = key.indexOf(":");
                    const candidate = downloadCandidates.find(item => item.key === key);
                    const group = candidate?.seasonLabel ?? `Сезон ${key.slice(0, separator)}`;
                    return `• ${group}, серия ${key.slice(separator + 1)}: нет озвучки «${effectiveDownloadDubbing}».`;
                }),
            ].join("\n"));
            return false;
        }
        const selected = keys
            .map(key => downloadVideoChoices.get(key))
            .filter((video): video is Video & {__season: number} => Boolean(video));
        return queueDownloadVideos(selected);
    };

    const cancelActiveDownload = async (jobId: string) => {
        const job = downloadJobs.find(item => item.id === jobId);
        if (!job || !ACTIVE_DOWNLOAD_STATUSES.has(job.status) || isCancellingDownload) return;

        try {
            setIsCancellingDownload(true);
            setDownloadNotice("Отменяем скачивание…");
            await cancelDownload(job.id);
            setDownloadJobs(current => current.map(item => item.id === job.id
                ? {...item, status: "cancelled", error: ""}
                : item));
            setDownloadNotice("Скачивание отменено. Недокачанный файл удалён.");
        } catch (error) {
            setDownloadNotice(error instanceof Error
                ? error.message
                : "Не удалось отменить скачивание.");
        } finally {
            setIsCancellingDownload(false);
        }
    };

    const primaryDownloadJob = activeDownloadJobs.find(
        job => job.status === "downloading" || job.status === "paused",
    ) ?? [...activeDownloadJobs].sort(
        (left, right) => (left.queuePosition ?? 999) - (right.queuePosition ?? 999),
    )[0] ?? downloadJobs[0];

    return {
        activeDownloadJobs,
        cancelActiveDownload,
        changeDownloadQuality,
        downloadCandidates,
        downloadDubbings,
        downloadIsActive: activeDownloadJobs.length > 0,
        downloadNotice,
        downloadPickerOpen,
        downloadQualityOptions,
        effectiveDownloadDubbing,
        isSubmittingDownload,
        requestSelectedDownloads,
        setDownloadDubbing,
        setDownloadPickerOpen,
        visibleDownloadNotice: downloadNotice
            || (primaryDownloadJob ? downloadJobText(primaryDownloadJob) : ""),
    };
}
