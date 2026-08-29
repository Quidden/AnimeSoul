"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Anime, AnimeProgress, Folder, PartyPlayback, PlayerPrefs, ScheduleEntry, SeasonGroup, ToolbarPosition, Tracker, Video } from "../lib/types";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K } from "../lib/settings";
import { readLocal as read, writeLocal as write } from "../lib/storage";
import { byViewingOrder, episodeDuration, episodeResumePosition, fetchFamily, formatCalendarDate, formatDuration, formatTime, franchiseName, isEpisodeWatched, isExtraAnime, isMovieAnime, isOvaAnime, latestResumePoint, releaseStatus, shortEntryTitle, stripPart, toggleEpisodeWatched } from "../lib/anime";
import { EpisodeSlideshow, episodePreviewImages } from "./EpisodeSlideshow";
import { FolderPicker } from "./FolderPicker";
import { useWatchParty, WATCH_PARTY_SESSION_KEY } from "../hooks/useWatchParty";
import { isKodikEmbed, kodikSerialIdentity, kodikSerialSource, playerDubbing, playerEpisode, playerTranslationId } from "../lib/kodik";
import { listenAppEvent } from "../lib/events";
import type { WatchProps } from "../features/player/types";
import { SeasonList } from "../features/player/SeasonList";
import { WatchInfo } from "../features/player/WatchInfo";
import { ReleaseSchedule, type ReleaseScheduleRow } from "../features/player/ReleaseSchedule";
import { WatchPartyPanel } from "../features/player/WatchPartyPanel";
import { PlayerToolbar } from "../features/player/PlayerToolbar";
import { AnimeSoulPlayer } from "../features/player/AnimeSoulPlayer";
import { RatingBoard } from "./RatingBoard";
import { ScorePicker } from "./ScorePicker";
import type { KodikStreamInfo, KodikStreamRequest } from "../lib/kodikStream";
import {
  dubbingDurationDeficit,
  dubbingHasEpisode,
  isSubtitleTranslation,
  preferredDubbing,
  preferredDubbingForEpisode,
  preferredOfflineVideo,
  preferredPlayer,
  playbackAnimeForVideo,
  subtitleTranslationLabel,
} from "../lib/playerPreferences";
import {
  cancelDownload,
  checkDownloadAvailability,
  enqueueDownload,
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
} from "../lib/downloads";
import { DownloadPicker, type DownloadCandidate } from "../features/downloads/DownloadPicker";
import { IS_ANDROID_APP } from "../lib/platform";
import {
  createPlaybackProgressTarget,
  nextEpisodeInSeason,
  recordPlaybackObservation,
  type PlaybackProgressTarget,
} from "../lib/playerProgress";
import {
  CatalogVideoRequestError,
  fetchAnimeDetails,
  fetchAnimeVideoResult,
} from "../features/catalog/api";
import { videoSourceIssues, type VideoSourceIssue } from "../lib/sourceDiagnostics";

const ANIMESOUL_PLAYER = "AnimeSoul";

function isSubtitleVideo(video: Video) {
  return isSubtitleTranslation(video.data.dubbing, video.data.translation_type);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(Math.max(1, concurrency), items.length)}, run),
  );
  return results;
}

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

export function Watch({ header, anime, resumeRequested, newEpisodeRequested, favorite, onFavorite, onBack, onLibrary, onGenre, saved, ratings, communityRating, onRatingChange, onProgress, onPlayerPrefsChange, onFolders, tracker, onTrack, onUntrack, folderPicker, folders, toggleFolder, createFolder, closePicker }: WatchProps) {
  const storedPlayerPrefs = read<Partial<PlayerPrefs>>(K.playerPrefs, {});
  const legacyPreferredDubbing = storedPlayerPrefs.dubbingPreferenceVersion === 2
    ? ""
    : Object.values(storedPlayerPrefs.titleDubbings ?? {}).at(-1) ?? "";
  const initialPrefs = {
    ...DEFAULT_PLAYER_PREFS,
    ...storedPlayerPrefs,
    ...(storedPlayerPrefs.dubbingPreferenceVersion === 2 ? {} : {
      preferredDubbing: storedPlayerPrefs.preferredDubbing || legacyPreferredDubbing,
      titleDubbings: {},
      dubbingPreferenceVersion: 2 as const,
    }),
    ...(IS_ANDROID_APP ? { watchPartyEnabled: false } : {}),
  };
  const storedResumePoint = resumeRequested ? latestResumePoint(saved) : null;
  const resumeSeason = storedResumePoint?.season ?? saved?.season ?? 1;
  const resumeEpisode = storedResumePoint?.episode ?? saved?.episode ?? "1";
  const topLevelResumeKey = `${saved?.season ?? 1}:${saved?.episode ?? "1"}`;
  const resumeUsesTopLevelOrigin = !storedResumePoint || storedResumePoint.key === topLevelResumeKey;
  const resumeOriginAnimeId = storedResumePoint?.state.originAnimeId
    ?? (resumeUsesTopLevelOrigin ? saved?.originAnimeId : undefined);
  const resumeOriginEpisode = storedResumePoint?.state.originEpisode
    ?? (resumeUsesTopLevelOrigin ? saved?.originEpisode : undefined);
  const resumeDubbing = storedResumePoint?.state.dub ?? saved?.dub ?? "";
  const [dub, setDub] = useState(saved?.dub ?? ""), [episode, setEpisode] = useState(resumeEpisode), [player, setPlayer] = useState(""), [autoNext, setAutoNextState] = useState(initialPrefs.autoNext), [autoSkip, setAutoSkipState] = useState(initialPrefs.autoSkipOpening), [autoSkipEnding, setAutoSkipEndingState] = useState(initialPrefs.autoSkipEnding), [autoPlayResume, setAutoPlayResumeState] = useState(initialPrefs.autoPlayResume), [autoScrollPlayer, setAutoScrollPlayerState] = useState(initialPrefs.autoScrollPlayer), [episodeCarousel, setEpisodeCarousel] = useState(initialPrefs.playerEpisodeCarousel), [status, setStatus] = useState("Загружаем серии…"), [position, setPosition] = useState<ToolbarPosition>(read(K.toolbar, "bottom")), [autoPlay, setAutoPlay] = useState(false), [seasons, setSeasons] = useState<SeasonGroup[]>([{ number: 1, entries: [anime] }]), [selectedSeason, setSelectedSeason] = useState(resumeSeason), [seasonVideos, setSeasonVideos] = useState<Record<number, Video[]>>({}), [schedule, setSchedule] = useState<Record<number, ScheduleEntry>>({}), [showUpcoming, setShowUpcoming] = useState(false), [carouselMotion, setCarouselMotion] = useState<"" | "previous" | "next">("");
  const [episodeHoverPreview, setEpisodeHoverPreview] = useState(initialPrefs.episodeHoverPreview);
  const [offlineAnime, setOfflineAnime] = useState<OfflineAnime | null>(() => peekOfflineAnime(anime.anime_id));
  const [offlineLookupReady, setOfflineLookupReady] = useState(() => hasOfflineAnimeLookup(anime.anime_id));
  const [localPlaybackReady, setLocalPlaybackReady] = useState(false);
  const [kodikAccessReady, setKodikAccessReady] = useState(false);
  const [seasonLoadNotice, setSeasonLoadNotice] = useState("");
  const [sourceLoadIssues, setSourceLoadIssues] = useState<VideoSourceIssue[]>([]);
  const [showSourceLoadIssues, setShowSourceLoadIssues] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<number>(read("animesoul:download-quality", 720));
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);
  const [downloadDubbing, setDownloadDubbing] = useState(saved?.dub ?? "");
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [isCancellingDownload, setIsCancellingDownload] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState("");
  const [remoteSourcesUnavailable, setRemoteSourcesUnavailable] = useState(false);
  const [directStreamInfo, setDirectStreamInfo] = useState<{ key: string; info: KodikStreamInfo } | null>(null);
  const [partyOnlineOnly, setPartyOnlineOnly] = useState(() => Boolean(
    initialPrefs.watchPartyEnabled && read<{ roomId?: string } | null>(WATCH_PARTY_SESSION_KEY, null)?.roomId,
  ));
  const [renderedIframeSource, setRenderedIframeSource] = useState("");
  const [partyRoomCode, setPartyRoomCode] = useState(""), [partyTime, setPartyTime] = useState(0), [partyDuration, setPartyDuration] = useState(0), [partyPlaying, setPartyPlaying] = useState(false);
  const [suggestedHostDub, setSuggestedHostDub] = useState<string | null>(null), [partyDubNotice, setPartyDubNotice] = useState("");
  const [previewAnimeById, setPreviewAnimeById] = useState<Record<number, Anime>>({});
  const collapsedSeasonsKey = `animesoul:collapsed-seasons:${anime.anime_id}`;
  const [collapsedSeasons, setCollapsedSeasons] = useState<number[]>(read(collapsedSeasonsKey, []));
  const iframe = useRef<HTMLIFrameElement>(null), localVideo = useRef<HTMLVideoElement>(null), playerFrame = useRef<HTMLDivElement>(null), playerShell = useRef<HTMLDivElement>(null), newEpisodeOpened = useRef(false), videoLoadId = useRef(0), lastPartyTime = useRef(0), lastPartyMotionAt = useRef(0), partyPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null), lastHostPlaying = useRef<boolean | null>(null), pendingPartyPlayback = useRef<PartyPlayback | null>(null), dismissedHostDub = useRef<string | null>(null), latestHostPlayback = useRef<PartyPlayback | null>(null);
  const playerManagedEpisodeSwitch = useRef(false);
  const renderedIframeIdentity = useRef("");
  const selectionReportedByPlayer = useRef(false);
  const lastEpisodeCommand = useRef("");
  // Fullscreen belongs to the already mounted Kodik document. Updating the
  // React selection while that document changes an episode can make Chromium
  // tear down fullscreen. Keep the real player selection in refs and only
  // mirror it into AnimeSoul's controls after the user leaves fullscreen.
  const fullscreenActive = useRef(false);
  const fullscreenPromotion = useRef(false);
  const initialResumeSelectionPending = useRef(true);
  const playbackCursor = useRef({ season: resumeSeason, episode: resumeEpisode, dub: saved?.dub ?? "", player: "" });
  const latestUiSelection = useRef({ season: resumeSeason, episode: resumeEpisode, dub: saved?.dub ?? "", player: "" });
  const deferredFullscreenSelection = useRef<{ season: number; episode: string; dub?: string; player?: string } | null>(null);
  const pendingPlayerEpisodeSwitch = useRef<{
    displaySeason: number;
    displayEpisode: string;
    originEpisode: string;
    timeoutId?: ReturnType<typeof setTimeout>;
    retryIds: ReturnType<typeof setTimeout>[];
  } | null>(null);
  const autoNextTransitionKey = useRef("");
  const savedRef = useRef(saved), pendingProgress = useRef<{ value: AnimeProgress; originEpisodeKey?: string } | null>(null), progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null), lastProgressCommit = useRef(0);
  const onProgressRef = useRef(onProgress);
  const pendingResumeSeek = useRef<{ episodeKey: string; target: number; expiresAt: number; lastAttemptAt: number } | null>(null);
  // Keep the navigation target immutable while the iframe is starting. Some
  // players emit a 0-second update before `load`, which must not erase the
  // position that the user explicitly asked to continue from.
  const initialResumeTarget = useRef({
    episodeKey: `${resumeSeason}:${resumeEpisode}`,
    position: episodeResumePosition(
      storedResumePoint?.state ?? saved?.episodes[`${resumeSeason}:${resumeEpisode}`],
    ),
  });
  useEffect(() => { savedRef.current = saved ;}, [saved]);
  useEffect(() => { onProgressRef.current = onProgress ;}, [onProgress]);
  const command = (method: string, extra: Record<string, unknown> & { seconds?: number } = {}) => {
    const video = localVideo.current;
    if ((current?.offline || effectivePlayer === ANIMESOUL_PLAYER) && video) {
      if (method === "play") void video.play().catch(() => undefined);
      else if (method === "pause") video.pause();
      else if (method === "seek" && Number.isFinite(extra.seconds)) video.currentTime = Math.max(0, extra.seconds ?? 0);
      return;
    }
    iframe.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method, ...extra } }, "*");
  };
  const fullscreenElement = () => {
    const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element | null };
    return fullscreenDocument.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
  };
  const hasStableFullscreenOwner = () => fullscreenElement() === playerFrame.current;
  const toggleStableFullscreen = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const frame = playerFrame.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    const fullscreenDocument = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    if (!frame) return;
    if (fullscreenElement() === frame) {
      const exit = document.exitFullscreen ? document.exitFullscreen() : fullscreenDocument.webkitExitFullscreen?.();
      Promise.resolve(exit).catch(() => undefined);
      return;
    }
    const request = frame.requestFullscreen
      ? frame.requestFullscreen({ navigationUI: "hide" })
      : frame.webkitRequestFullscreen?.();
    Promise.resolve(request).catch(() => undefined);
  };
  const isPlayerFullscreen = () => {
    const activeElement = fullscreenElement();
    if (!activeElement) return false;
    return activeElement === iframe.current
      || activeElement === playerFrame.current
      || activeElement === playerShell.current
      || Boolean(playerShell.current?.contains(activeElement))
      || Boolean(iframe.current && activeElement.contains(iframe.current));
  };
  const queueFullscreenSelection = (selection: { season: number; episode: string; dub?: string; player?: string }) => {
    playbackCursor.current = {
      season: selection.season,
      episode: selection.episode,
      dub: selection.dub ?? playbackCursor.current.dub,
      player: selection.player ?? playbackCursor.current.player,
    };
    deferredFullscreenSelection.current = {
      ...(deferredFullscreenSelection.current ?? {}),
      ...selection,
      season: selection.season,
      episode: selection.episode,
    };
  };
  const cancelPendingPlayerEpisodeSwitch = () => {
    const pending = pendingPlayerEpisodeSwitch.current;
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    pending?.retryIds.forEach(clearTimeout);
    pendingPlayerEpisodeSwitch.current = null;
  };
  const persistPrefs = (prefs: PlayerPrefs, hoverPreview = episodeHoverPreview) => {
    const stored = { ...DEFAULT_PLAYER_PREFS, ...read<Partial<PlayerPrefs>>(K.playerPrefs, {}) };
    const next = {
      ...stored,
      ...prefs,
      homeEpisodePreview: stored.homeEpisodePreview,
      homePreviewMode: stored.homePreviewMode,
      episodeHoverPreview: hoverPreview,
    };
    write(K.playerPrefs, next);
    onPlayerPrefsChange(next);
  };
  const patchPrefs = (patch: Partial<PlayerPrefs>, hoverPreview = episodeHoverPreview) => {
    persistPrefs({ ...initialPrefs, ...patch }, hoverPreview);
  };
  const toggleSeason = (season: number) => {
    setCollapsedSeasons(current => {
      const next = current.includes(season) ? current.filter(item => item !== season) : [...current, season];
      write(collapsedSeasonsKey, next);
      return next;
    });
  };
  const familyRoot = useMemo(() => franchiseName(anime.title), [anime.title]);
  const base = familyRoot;
  useEffect(() => {
    videoLoadId.current += 1;
    const cachedOfflineAnime = peekOfflineAnime(anime.anime_id);
    const cachedLookupReady = hasOfflineAnimeLookup(anime.anime_id);
    setOfflineAnime(cachedOfflineAnime);
    setOfflineLookupReady(cachedLookupReady);
    setLocalPlaybackReady(false);
    setDownloadJobs([]);
    setDownloadPickerOpen(false);
    setDownloadDubbing(resumeDubbing);
    setRemoteSourcesUnavailable(false);
    setDirectStreamInfo(null);
    setSeasonVideos({});
    setSeasons([{ number: 1, entries: [anime] }]);
    setSourceLoadIssues([]);
    setShowSourceLoadIssues(false);
    initialResumeSelectionPending.current = true;
    initialResumeTarget.current = {
      episodeKey: `${resumeSeason}:${resumeEpisode}`,
      position: episodeResumePosition(
        storedResumePoint?.state ?? saved?.episodes[`${resumeSeason}:${resumeEpisode}`],
      ),
    };
    playbackCursor.current = { season: resumeSeason, episode: resumeEpisode, dub: resumeDubbing, player: "" };
    latestUiSelection.current = { season: resumeSeason, episode: resumeEpisode, dub: resumeDubbing, player: "" };
    setSelectedSeason(resumeSeason);
    setEpisode(resumeEpisode);
    setDub(resumeDubbing);
    setPlayer("");
    setStatus(cachedOfflineAnime ? "" : cachedLookupReady ? "Загружаем серии…" : "Проверяем скачанные серии…");
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
  useEffect(() => {
    const hasActiveDownload = downloadJobs.some(job => ["queued", "downloading", "paused"].includes(job.status));
    if (!hasActiveDownload) return;
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
  }, [anime.anime_id, downloadJobs.map(job => `${job.id}:${job.status}`).join("|")]);

  useEffect(() => {
    let stopped = false;
    const refreshAccess = () => {
      fetchOfflineSettings()
        .then(settings => {
          if (stopped) return;
          setKodikAccessReady(hasKodikSecretAccess(settings));
        })
        .catch(() => {
          if (stopped) return;
          setKodikAccessReady(false);
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
  const mergeOfflineVideos = (remote: Record<number, Video[]>) => {
    const result: Record<number, Video[]> = {};
    const seasonsWithVideos = new Set([...Object.keys(remote), ...Object.keys(offlineVideosBySeason)].map(Number));
    for (const season of seasonsWithVideos) {
      const online = (remote[season] ?? []).filter(video => !video.offline);
      result[season] = [...online, ...(offlineVideosBySeason[season] ?? [])];
    }
    return result;
  };
  useEffect(() => {
    const offlineSeasons = Object.keys(offlineVideosBySeason).map(Number);
    if (!offlineSeasons.length) return;
    setSeasons(current => {
      const present = new Set(current.map(group => group.number));
      const additions = offlineSeasons
        .filter(number => !present.has(number))
        .map(number => ({ number, entries: [anime], label: `Сезон ${number}`, kind: "season" as const }));
      return additions.length ? [...current, ...additions].sort((left, right) => left.number - right.number) : current;
    });
  }, [anime, offlineVideosKey]);
  useEffect(() => {
    setSeasonVideos(current => mergeOfflineVideos(current));
    if (offlineVideosKey) setStatus("");
  }, [offlineVideosKey]);
  useEffect(() => {
    if (!offlineVideosKey || seasonVideos[selectedSeason]?.length) return;
    const firstOfflineSeason = Math.min(...Object.keys(offlineVideosBySeason).map(Number));
    if (Number.isFinite(firstOfflineSeason)) setSelectedSeason(firstOfflineSeason);
  }, [offlineVideosKey, selectedSeason, seasonVideos, offlineVideosBySeason]);
  useEffect(() => {
    if (!offlineVideosKey || localPlaybackReady) return;
    // A damaged or externally removed file must not prevent online fallback
    // forever. Healthy local MP4/HLS files report metadata long before this.
    const timer = window.setTimeout(() => setLocalPlaybackReady(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [offlineVideosKey, localPlaybackReady]);
  useEffect(() => {
    const prefsChanged = (prefs: PlayerPrefs) => {
      setAutoNextState(prefs.autoNext);
      setAutoSkipState(prefs.autoSkipOpening);
      setAutoSkipEndingState(prefs.autoSkipEnding);
      setAutoPlayResumeState(prefs.autoPlayResume);
      setAutoScrollPlayerState(prefs.autoScrollPlayer);
      setEpisodeCarousel(prefs.playerEpisodeCarousel);
      setEpisodeHoverPreview(prefs.episodeHoverPreview);
    };
    const toolbarChanged = (toolbar: ToolbarPosition) => setPosition(toolbar);
    const stopPrefs = listenAppEvent("player-prefs", prefsChanged);
    const stopToolbar = listenAppEvent("toolbar", toolbarChanged);
    return () => {
      stopPrefs();
      stopToolbar();
    };
  }, []);
  useEffect(() => {
    if (!offlineLookupReady || (offlineAnime && !localPlaybackReady)) return;
    const controller = new AbortController();
    void fetchFamily(anime, familyRoot, controller.signal).then(found => {
      if (controller.signal.aborted) return;
      const source = found.length ? found : [anime];
      const series = source.filter(item => !isMovieAnime(item) && !isExtraAnime(item));
      const movies = source.filter(isMovieAnime);
      const extras = source.filter(isExtraAnime);
      const arcs = new Map<string, Anime[]>();
      for (const item of series) {
        const arc = stripPart(item.title);
        arcs.set(arc, [...(arcs.get(arc) ?? []), item]);
      }
      const seasonGroups = [...arcs.entries()]
        .sort(([, left], [, right]) => (
          Math.min(...left.map(item => item.data?.index ?? 9999))
          - Math.min(...right.map(item => item.data?.index ?? 9999))
        ) || (
          Math.min(...left.map(item => item.year ?? 9999))
          - Math.min(...right.map(item => item.year ?? 9999))
        ))
        .map(([, entries], index): SeasonGroup => ({
          number: 0,
          entries: [...entries].sort(byViewingOrder),
          label: `Сезон ${index + 1}`,
          kind: "season",
        }));
      const extraGroups = extras.sort(byViewingOrder).map((entry): SeasonGroup => ({
        number: 0,
        entries: [entry],
        label: `${isOvaAnime(entry) ? "OVA" : entry.type?.alias === "ona" ? "ONA" : "Спецвыпуск"} · ${shortEntryTitle(entry.title, familyRoot)}`,
        kind: "special",
      }));
      const movieGroups = movies.sort(byViewingOrder).map((entry): SeasonGroup => ({
        number: 0,
        entries: [entry],
        label: `Фильм · ${shortEntryTitle(entry.title, familyRoot)}`,
        kind: "movie",
      }));
      const groups = [...seasonGroups, ...extraGroups, ...movieGroups]
        .sort((left, right) => byViewingOrder(left.entries[0], right.entries[0]))
        .map((group, index) => ({ ...group, number: index + 1 }));
      if (!groups.length) return;
      setSeasons(groups);
      const originGroup = resumeOriginAnimeId
        ? groups.find(group => group.entries.some(entry => entry.anime_id === resumeOriginAnimeId))
        : undefined;
      const selected = originGroup?.number
        ?? (resumeSeason && groups.some(group => group.number === resumeSeason)
          ? resumeSeason
          : groups.find(group => group.entries.some(entry => entry.anime_id === anime.anime_id))?.number
            ?? groups[0].number);
      setSelectedSeason(selected);
    }).catch(() => {
      if (!controller.signal.aborted) setSeasonLoadNotice("Не удалось обновить состав франшизы. Показан выбранный тайтл.");
    });
    return () => controller.abort();
  }, [anime.anime_id, familyRoot, offlineLookupReady, offlineAnime?.animeId, localPlaybackReady]);
  const previewAnimeIds = useMemo(() => [...new Set(seasons.flatMap(group => group.entries.map(entry => entry.anime_id)))], [seasons]);
  useEffect(() => {
    if (!previewAnimeIds.length || !offlineLookupReady || (offlineAnime && !localPlaybackReady)) return;
    let cancelled = false;
    fetchAnimeDetails(previewAnimeIds)
      .then(entries => {
        if (cancelled) return;
        const merged = new Map<number, Anime>();
        for (const entry of entries) {
          merged.set(entry.anime_id, entry);
        }
        setPreviewAnimeById(Object.fromEntries(merged));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [previewAnimeIds.join(","), offlineLookupReady, offlineAnime?.animeId, localPlaybackReady]);
  useEffect(() => {
    if (!offlineLookupReady || (offlineAnime && !localPlaybackReady)) return;
    fetch("/api/yummy?mode=schedule")
      .then(r => r.json())
      .then(p => setSchedule(Object.fromEntries(((p.schedule ?? []) as ScheduleEntry[]).map(item => [item.anime_id, item]))))
      .catch(() => { });
  }, [anime.anime_id, offlineLookupReady, offlineAnime?.animeId, localPlaybackReady]);
  const fetchVideos = async (refresh = false) => {
    const loadId = ++videoLoadId.current;
    const localVideos = () => mergeOfflineVideos({});
    const hasOfflineEpisodes = Object.values(offlineVideosBySeason).some(list => list.length > 0);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setRemoteSourcesUnavailable(hasOfflineEpisodes);
      setSeasonVideos(localVideos());
      setStatus(hasOfflineEpisodes ? "" : "Нет интернета и скачанных серий");
      const issues = videoSourceIssues({
        animeId: anime.anime_id,
        title: anime.title,
        seasonLabel: "Онлайн-источники",
        sources: {},
        loadedVideos: 0,
        requestError: "устройство сейчас без подключения к интернету",
      });
      setSourceLoadIssues(issues);
      setSeasonLoadNotice(hasOfflineEpisodes
        ? "Онлайн-источники недоступны. Открыты скачанные серии."
        : "Онлайн-источники недоступны, а скачанных серий нет.");
      return;
    }

    if (hasOfflineEpisodes) {
      // The local library is authoritative enough to start watching. Remote
      // seasons are enrichment and must never cover or restart that video.
      setSeasonVideos(current => mergeOfflineVideos(current));
      setStatus("");
      // Let the browser open the local file and read its metadata before any
      // provider requests compete for CPU/network or alter source selection.
      if (!refresh && !localPlaybackReady) return;
    } else {
      setStatus("Загружаем сезоны…");
    }
    setSeasonLoadNotice("");
    setSourceLoadIssues([]);
    setShowSourceLoadIssues(false);
    try {
      const remote: Record<number, Video[]> = {};
      let completedGroups = 0;

      const loadGroup = async (group: SeasonGroup) => {
        const ordered = [...group.entries].sort(byViewingOrder);
        const payloads = await mapWithConcurrency(ordered, 2, async entry => {
          try {
            const result = await fetchAnimeVideoResult(entry.anime_id, { refresh });
            return {
              entry,
              list: result.videos,
              issues: videoSourceIssues({
                animeId: entry.anime_id,
                title: entry.title,
                seasonLabel: group.label ?? `Сезон ${group.number}`,
                sources: result.sources,
                loadedVideos: result.videos.length,
              }),
            };
          } catch (error) {
            const requestError = error instanceof Error
              ? error.message
              : "не удалось выполнить запрос серий";
            const sources = error instanceof CatalogVideoRequestError ? error.sources : {};
            return {
              entry,
              list: [] as Video[],
              issues: videoSourceIssues({
                animeId: entry.anime_id,
                title: entry.title,
                seasonLabel: group.label ?? `Сезон ${group.number}`,
                sources,
                loadedVideos: 0,
                requestError,
              }),
            };
          }
        });
        let offset = 0;
        const normalized = payloads.flatMap(({ entry, list }) => {
          const kind: Video["contentKind"] = group.kind === "movie"
            ? "Фильм"
            : isOvaAnime(entry)
              ? "OVA"
              : entry.type?.alias === "ona"
                ? "ONA"
                : entry.type?.alias === "special"
                  ? "Спешл"
                  : "Серия";
          const mapped = list.map(video => ({
            ...video,
            originAnimeId: entry.anime_id,
            originNumber: video.number,
            contentKind: kind,
            contentTitle: entry.title,
            number: String((Number(video.number) || 1) + offset),
          }));
          offset += new Set(list.map(video => video.number)).size;
          return mapped;
        });
        const unique = [...new Map(normalized.map(video => [video.video_id, video])).values()];
        remote[group.number] = unique;
        completedGroups += 1;
        if (loadId === videoLoadId.current) {
          const partial = mergeOfflineVideos(remote);
          setSeasonVideos(partial);
          if (hasOfflineEpisodes || (partial[selectedSeason] ?? []).length > 0) setStatus("");
          else setStatus(`Загружаем сезоны… ${completedGroups} из ${seasons.length}`);
        }
        return { number: group.number, videos: unique, issues: payloads.flatMap(payload => payload.issues) };
      };
      const selectedGroup = seasons.find(group => group.number === selectedSeason);
      const remainingGroups = seasons.filter(group => group.number !== selectedGroup?.number);
      const loaded = selectedGroup ? [await loadGroup(selectedGroup)] : [];
      if (loadId !== videoLoadId.current) return;
      loaded.push(...await mapWithConcurrency(remainingGroups, 2, loadGroup));
      if (loadId !== videoLoadId.current) return;
      Object.assign(remote, Object.fromEntries(loaded.map(group => [group.number, group.videos])));
      const issues = loaded.flatMap(group => group.issues);
      const hasRemoteEpisodes = Object.values(remote).some((list: Video[]) => list.length > 0);
      setRemoteSourcesUnavailable(!hasRemoteEpisodes && hasOfflineEpisodes);
      const next = hasRemoteEpisodes ? mergeOfflineVideos(remote) : localVideos();
      setSeasonVideos(next);
      setStatus((next[selectedSeason] ?? []).length
        ? ""
        : Object.values(next).some((list: Video[]) => list.length)
          ? "Этот сезон временно не загрузился. Выберите доступный сезон или повторите."
          : "Видео временно не загрузились");
      setSourceLoadIssues(issues);
      if (issues.length > 0 && hasRemoteEpisodes) {
        setSeasonLoadNotice(`Часть данных не загрузилась (${issues.length}). Доступные серии уже можно смотреть.`);
      } else if (issues.length > 0) {
        setSeasonLoadNotice("Источники видео временно не ответили. Можно повторить загрузку.");
      }
    } catch (error) {
      if (loadId !== videoLoadId.current) return;
      setRemoteSourcesUnavailable(hasOfflineEpisodes);
      setSeasonVideos(localVideos());
      setStatus(hasOfflineEpisodes ? "" : "Не удалось загрузить серии");
      setSourceLoadIssues(videoSourceIssues({
        animeId: anime.anime_id,
        title: anime.title,
        seasonLabel: "Все сезоны",
        sources: {},
        loadedVideos: 0,
        requestError: error instanceof Error ? error.message : "не удалось загрузить серии",
      }));
      setSeasonLoadNotice(hasOfflineEpisodes
        ? "Онлайн-источники недоступны. Открыты скачанные серии."
        : "Не удалось загрузить серии. Проверьте соединение и повторите попытку.");
    }
  };
  useEffect(() => {
    if (!offlineLookupReady) return;
    void fetchVideos();
  }, [seasons.map(s => s.entries.map(e => e.anime_id).join(",")).join("|"), offlineVideosKey, offlineLookupReady, localPlaybackReady]);
  const displaySeasons = remoteSourcesUnavailable
    ? seasons.filter(group => (seasonVideos[group.number] ?? []).some(video => video.offline))
    : seasons;
  const videos = seasonVideos[selectedSeason] ?? [];
  const voiceVideos = videos.filter(video => !isSubtitleVideo(video));
  const selectedGroup = displaySeasons.find(group => group.number === selectedSeason);
  const titlePreferenceKey = String(anime.anime_id);
  const favouriteDubbings = initialPrefs.favoriteDubbings ?? [];
  const manualDubbing = initialPrefs.titleDubbings?.[titlePreferenceKey] ?? "";
  const globalDubbing = initialPrefs.preferredDubbing ?? "";
  const titlePlayer = initialPrefs.titlePlayers?.[titlePreferenceKey] ?? "";
  const dubbingContext = `${anime.anime_id}:${selectedSeason}:${videos.map(video => video.video_id).join(",")}`;
  useEffect(() => {
    if (!videos.length) return;
    const requestedEpisode = episode;
    const episodeVideos = voiceVideos.filter(video => video.number === requestedEpisode);
    const episodeKodikDefault = episodeVideos.find(video => isKodikEmbed(video.iframe_url, video.data.player))?.data.dubbing;
    const rememberedDubbing = initialResumeSelectionPending.current ? resumeDubbing : dub;
    let nextDub = preferredDubbingForEpisode(
      voiceVideos,
      requestedEpisode,
      manualDubbing,
      globalDubbing,
      favouriteDubbings,
      rememberedDubbing,
      episodeKodikDefault,
    );
    let nextEpisode = requestedEpisode;
    if (!nextDub) {
      const available = Array.from(new Set(voiceVideos.map(video => video.data.dubbing)));
      const kodikDefault = voiceVideos.find(video => isKodikEmbed(video.iframe_url, video.data.player))?.data.dubbing;
      nextDub = preferredDubbing(available, manualDubbing, globalDubbing, favouriteDubbings, kodikDefault);
      const numbers = voiceVideos
        .filter(video => video.data.dubbing === nextDub)
        .map(video => video.number)
        .sort((a, b) => +a - +b);
      const originMatch = resumeOriginAnimeId && resumeOriginEpisode
        ? voiceVideos.find(video => video.originAnimeId === resumeOriginAnimeId && video.originNumber === resumeOriginEpisode && video.data.dubbing === nextDub)?.number
        : undefined;
      nextEpisode = originMatch ?? numbers[0] ?? "1";
    }
    initialResumeSelectionPending.current = false;
    setDub(nextDub);
    setEpisode(nextEpisode);
    setPlayer("");
  }, [dubbingContext]);
  const dubs = Array.from(new Set(voiceVideos.map(video => video.data.dubbing))).sort((left, right) => {
    const leftRank = left === manualDubbing ? -2 : left === globalDubbing ? -1 : favouriteDubbings.indexOf(left);
    const rightRank = right === manualDubbing ? -2 : right === globalDubbing ? -1 : favouriteDubbings.indexOf(right);
    const normalizedLeft = leftRank < 0 && left !== manualDubbing && left !== globalDubbing ? Number.MAX_SAFE_INTEGER : leftRank;
    const normalizedRight = rightRank < 0 && right !== manualDubbing && right !== globalDubbing ? Number.MAX_SAFE_INTEGER : rightRank;
    return normalizedLeft - normalizedRight;
  });
  const downloadDubbings = useMemo(() => Array.from(new Set(
    Object.values(seasonVideos)
      .flat()
      .filter(video => !video.offline && isKodikEmbed(video.iframe_url, video.data.player))
      .map(video => video.data.dubbing),
  )).sort((left, right) => left.localeCompare(right, "ru")), [seasonVideos]);
  const effectiveDownloadDubbing = downloadDubbings.includes(downloadDubbing)
    ? downloadDubbing
    : downloadDubbings.includes(dub)
      ? dub
      : downloadDubbings[0] ?? "";
  useEffect(() => {
    if (effectiveDownloadDubbing && effectiveDownloadDubbing !== downloadDubbing) {
      setDownloadDubbing(effectiveDownloadDubbing);
    }
  }, [effectiveDownloadDubbing, downloadDubbing]);
  const downloadVideoChoices = useMemo(() => {
    const selected = new Map<string, Video & { __season: number }>();
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
          selected.set(key, { ...video, __season: season });
        }
      }
    }
    return selected;
  }, [effectiveDownloadDubbing, seasonVideos]);
  const activeDownloadJobs = downloadJobs.filter(job => ["queued", "downloading", "paused"].includes(job.status));
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
      downloadJobs
        .filter(job => ["queued", "downloading", "paused"].includes(job.status) && job.quality === downloadQuality)
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
  }, [displaySeasons, downloadEpisodeKeys, downloadJobs, downloadQuality, downloadVideoChoices, effectiveDownloadDubbing, offlineAnime]);
  const currentEpisodeDubbings = new Set(
    voiceVideos.filter(video => video.number === episode).map(video => video.data.dubbing),
  );
  const dubbingOptions = dubs.map(value => {
    const durationDeficit = dubbingDurationDeficit(voiceVideos, value, episode);
    const warning = durationDeficit
      ? `По данным источника эта версия короче самой полной на ${formatTime(durationDeficit)}. Возможна другая редакция или вырезанные фрагменты.`
      : undefined;
    return {
      value,
      label: `${manualDubbing === value ? "● " : ""}${globalDubbing === value ? "♥ " : ""}${favouriteDubbings.includes(value) ? "★ " : ""}${warning ? "⚠ " : ""}${value}${currentEpisodeDubbings.has(value) ? "" : " · нет этой серии"}${durationDeficit ? ` · короче на ${formatTime(durationDeficit)}` : ""}`,
      disabled: !currentEpisodeDubbings.has(value),
      warning,
    };
  });
  const episodes = Array.from(new Set(voiceVideos.filter(video => video.data.dubbing === dub).map(video => video.number))).sort((a, b) => +a - +b);
  const episodeOptions = episodes.map(value => {
    const duration = episodeDuration(videos, value);
    const watched = isEpisodeWatched(saved?.episodes[`${selectedSeason}:${value}`]);
    return {
      value,
      label: `${value}${duration ? ` · ${formatDuration(duration)}` : ""}${watched ? " · Просмотрено" : ""}`,
    };
  });
  const sources = videos.filter(video => video.data.dubbing === dub && video.number === episode);
  const onlineSources = sources.filter(video => !video.offline);
  const subtitleSourceMap = new Map<string, Video>();
  for (const video of videos) {
    if (
      video.number !== episode
      || video.offline
      || !isSubtitleVideo(video)
      || !isKodikEmbed(video.iframe_url, video.data.player)
    ) continue;
    const key = subtitleTranslationLabel(video.data.dubbing).toLocaleLowerCase();
    const existing = subtitleSourceMap.get(key);
    const exact = Boolean(video.data.translation_id) || /\/seria\//i.test(video.iframe_url);
    const existingExact = Boolean(existing?.data.translation_id) || Boolean(existing && /\/seria\//i.test(existing.iframe_url));
    if (!existing || (exact && !existingExact)) subtitleSourceMap.set(key, video);
  }
  const subtitleSources = [...subtitleSourceMap.values()];
  const preferredOffline = partyOnlineOnly
    ? undefined
    : preferredOfflineVideo(sources, dub, episode, downloadQuality);
  const availableSources = partyOnlineOnly ? onlineSources : [...onlineSources, ...(preferredOffline ? [preferredOffline] : [])];
  const kodikSource = onlineSources.find(video => isKodikEmbed(video.iframe_url, video.data.player));
  const providerPlayers = Array.from(new Set(availableSources.map(video => video.data.player)));
  const animeSoulOnlineAvailable = Boolean(kodikAccessReady && kodikSource);
  const players = Array.from(new Set([...(animeSoulOnlineAvailable ? [ANIMESOUL_PLAYER] : []), ...providerPlayers]));
  const fallbackSource = preferredOffline ?? kodikSource ?? onlineSources[0];
  const defaultPlayer = preferredOffline?.data.player
    ?? preferredPlayer(players, titlePlayer, animeSoulOnlineAvailable, fallbackSource?.data.player);
  const effectivePlayer = players.includes(player) ? player : defaultPlayer;
  const current = effectivePlayer === ANIMESOUL_PLAYER
    ? kodikSource
    : availableSources.find(video => video.data.player === effectivePlayer) ?? fallbackSource;
  const useAnimeSoulPlayer = Boolean(
    current
    && (
      current.offline
      || (kodikAccessReady && effectivePlayer === ANIMESOUL_PLAYER && kodikSource)
    ),
  );
  const directPlaybackKey = useAnimeSoulPlayer && current
    ? `${current.offline?.episodeId ?? current.video_id}:${selectedSeason}:${episode}:${dub}`
    : "";
  const downloadQualityOptions = useMemo(() => {
    const resolved = directStreamInfo?.key === directPlaybackKey && effectiveDownloadDubbing === dub
      ? directStreamInfo.info.sources.map(source => source.quality)
      : [];
    return [...new Set(resolved.length ? resolved : [360, 480, 720])]
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
  }, [directPlaybackKey, directStreamInfo, dub, effectiveDownloadDubbing]);
  useEffect(() => {
    if (!downloadPickerOpen || downloadQualityOptions.includes(downloadQuality)) return;
    const next = [...downloadQualityOptions].reverse().find(value => value <= downloadQuality)
      ?? downloadQualityOptions.at(-1);
    if (!next) return;
    setDownloadQuality(next);
    write("animesoul:download-quality", next);
  }, [downloadPickerOpen, downloadQuality, downloadQualityOptions]);
  const resolvedDirectSkips = directStreamInfo?.key === directPlaybackKey ? directStreamInfo.info.skips : undefined;
  const playbackSkips = {
    opening: resolvedDirectSkips?.opening ?? current?.skips?.opening,
    ending: resolvedDirectSkips?.ending ?? current?.skips?.ending,
  };
  const openingEnd = playbackSkips.opening ? playbackSkips.opening.time + playbackSkips.opening.length : 0;
  const endingStart = playbackSkips.ending?.time ?? 0;
  const endingEnd = playbackSkips.ending
    ? playbackSkips.ending.time + playbackSkips.ending.length
    : (current?.duration ?? 0);
  const familyAnimeEntries = seasons.flatMap(group => group.entries);
  const streamRequestFor = (video: Video): KodikStreamRequest => {
    const sourceAnime = playbackAnimeForVideo(
      anime,
      familyAnimeEntries,
      previewAnimeById,
      video.originAnimeId,
    );
    const remoteIds = sourceAnime?.remote_ids;
    return {
    videoId: video.video_id,
    season: selectedSeason,
    episode: video.number,
    originAnimeId: video.originAnimeId ?? anime.anime_id,
    originEpisode: video.originNumber,
    dubbing: video.data.dubbing,
    translationId: video.data.translation_id,
    iframeUrl: video.iframe_url,
    ...(remoteIds?.shikimori_id
      ? { sourceId: String(remoteIds.shikimori_id), sourceIdType: "shikimori" as const }
      : remoteIds?.kp_id
        ? { sourceId: String(remoteIds.kp_id), sourceIdType: "kinopoisk" as const }
        : {}),
    sourceTitle: sourceAnime?.title,
    sourceOriginalTitle: sourceAnime?.original ?? sourceAnime?.title_en,
  };
  };
  const playerStreamRequest: KodikStreamRequest | undefined = useAnimeSoulPlayer && current
    ? current.offline
      ? {
          videoId: `offline:${current.offline.episodeId}`,
          season: selectedSeason,
          episode: current.number,
          originAnimeId: current.originAnimeId ?? anime.anime_id,
          originEpisode: current.originNumber,
          dubbing: current.data.dubbing,
          translationId: current.data.translation_id,
          iframeUrl: current.offline.mediaUrl,
          directStream: {
            sources: [{
              quality: current.offline.quality,
              src: current.offline.mediaUrl,
              type: current.offline.mediaType === "application/vnd.apple.mpegurl" ? "hls" : "video/mp4",
            }],
            subtitles: [],
            skips: current.offline.skips,
          },
        }
      : streamRequestFor(current)
    : undefined;
  const subtitleStreamOptions = subtitleSources.map(video => ({
    value: String(video.data.translation_id ?? video.video_id),
    label: subtitleTranslationLabel(video.data.dubbing),
    request: streamRequestFor(video),
  }));
  useEffect(() => {
    latestUiSelection.current = { season: selectedSeason, episode, dub, player: effectivePlayer };
    if (!fullscreenActive.current && !isPlayerFullscreen()) {
      playbackCursor.current = latestUiSelection.current;
    }
  }, [selectedSeason, episode, dub, effectivePlayer]);
  useEffect(() => {
    const fullscreenChanged = () => {
      const activeElement = fullscreenElement();
      if (activeElement && isPlayerFullscreen()) {
        fullscreenActive.current = true;
        playbackCursor.current = latestUiSelection.current;

        if (activeElement === playerFrame.current) {
          fullscreenPromotion.current = false;
          return;
        }

        // Kodik normally requests fullscreen for its cross-origin iframe. If
        // that iframe later replaces its internal episode document, Chromium
        // destroys the fullscreen element. Promote fullscreen ownership to
        // AnimeSoul's stable frame immediately; Kodik may then change videos
        // without changing the element owned by the browser fullscreen API.
        if (activeElement === iframe.current && playerFrame.current && !fullscreenPromotion.current) {
          fullscreenPromotion.current = true;
          const frame = playerFrame.current as HTMLDivElement & { webkitRequestFullscreen?: () => void };
          try {
            const request = frame.requestFullscreen
              ? frame.requestFullscreen({ navigationUI: "hide" })
              : frame.webkitRequestFullscreen?.();
            Promise.resolve(request).catch(() => {
            }).finally(() => {
              fullscreenPromotion.current = false;
            });
          } catch {
            fullscreenPromotion.current = false;
          }
        }
        return;
      }
      if (fullscreenPromotion.current) return;
      if (!fullscreenActive.current) return;
      fullscreenActive.current = false;
      const deferred = deferredFullscreenSelection.current;
      deferredFullscreenSelection.current = null;
      if (!deferred) return;
      // The user has now left fullscreen, so it is safe to synchronize the
      // surrounding page, dropdowns, carousel and progress labels in one pass.
      playerManagedEpisodeSwitch.current = true;
      selectionReportedByPlayer.current = true;
      setShowUpcoming(false);
      setSelectedSeason(deferred.season);
      setEpisode(deferred.episode);
      if (deferred.dub) setDub(deferred.dub);
      if (deferred.player) setPlayer(deferred.player);
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    document.addEventListener("webkitfullscreenchange", fullscreenChanged as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      document.removeEventListener("webkitfullscreenchange", fullscreenChanged as EventListener);
    };
  }, []);
  useEffect(() => {
    if (!players.length) return;
    if (!players.includes(player)) setPlayer(defaultPlayer);
  }, [dub, episode, players.join("|"), partyOnlineOnly, downloadQuality, defaultPlayer]);
  const localPartyPlayback: PartyPlayback = { animeId: anime.anime_id, season: selectedSeason, episode, dub, player: effectivePlayer, position: partyTime, duration: partyDuration || current?.duration || 0, playing: partyPlaying, updatedAt: Date.now() };
  const applyHostState = (host: PartyPlayback, force = false) => {
    if (host.animeId !== anime.anime_id) return;
    latestHostPlayback.current = host;
    const targetVideos = (seasonVideos[host.season] ?? []).filter(video => !video.offline);
    const hostDubAvailable = targetVideos.some(video => video.number === host.episode && video.data.dubbing === host.dub);
    const ownDubAvailable = targetVideos.some(video => video.number === host.episode && video.data.dubbing === dub);
    let targetDub = dub;
    if (initialPrefs.watchPartyDubMode === "follow" && hostDubAvailable) targetDub = host.dub;
    if (initialPrefs.watchPartyDubMode === "suggest" && host.dub !== dub && hostDubAvailable && dismissedHostDub.current !== host.dub) setSuggestedHostDub(host.dub);
    if (host.dub !== dub && !hostDubAvailable) setPartyDubNotice(`Озвучка хоста «${host.dub}» недоступна для этой серии — оставлена локальная.`);
    else if (ownDubAvailable || targetDub === host.dub) setPartyDubNotice("");
    if (!ownDubAvailable && targetDub === dub && hostDubAvailable) {
      targetDub = host.dub;
      setPartyDubNotice(`В твоей озвучке этой серии нет — временно выбрана «${host.dub}».`);
    }
    const targetHasKodik = targetVideos.some(video => video.number === host.episode && video.data.dubbing === targetDub && isKodikEmbed(video.iframe_url, video.data.player));
    const targetPlayer = kodikAccessReady && host.player === ANIMESOUL_PLAYER && targetHasKodik
      ? ANIMESOUL_PLAYER
      : targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub && video.data.player === host.player)?.data.player
      ?? targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub && /kodik/i.test(video.data.player))?.data.player
      ?? targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub)?.data.player
      ?? player;
    const selectionChanged = host.season !== selectedSeason || host.episode !== episode || targetDub !== dub || targetPlayer !== effectivePlayer;
    if (selectionChanged) {
      pendingPartyPlayback.current = { ...host, dub: targetDub, player: targetPlayer };
      setSelectedSeason(host.season);
      setDub(targetDub);
      setEpisode(host.episode);
      setPlayer(targetPlayer);
      setAutoPlay(host.playing);
      return;
    }
    // `updatedAt` comes from another computer and its clock may be skewed.
    // The reported position is authoritative; regular party heartbeats keep
    // playing clients close without extrapolating against foreign wall time.
    const hostNow = host.position;
    if (force || (initialPrefs.watchPartyAutoCatchUp && Math.abs(hostNow - partyTime) > 5)) command("seek", { seconds: hostNow });
    // A local pause/play does not change lastHostPlaying. Compare with the
    // actual player state too, otherwise a remote resume can be skipped.
    if (partyPlaying !== host.playing || lastHostPlaying.current !== host.playing) {
      command(host.playing ? "play" : "pause");
      lastHostPlaying.current = host.playing;
    }
  };
  const party = useWatchParty({ enabled: initialPrefs.watchPartyEnabled, server: initialPrefs.watchPartyServer, name: initialPrefs.watchPartyName, mode: initialPrefs.watchPartyMode, roomMode: initialPrefs.watchPartyRoomMode, playback: localPartyPlayback, onHostState: applyHostState, onSessionChange: setPartyOnlineOnly });
  useEffect(() => {
    if (!initialPrefs.watchPartyEnabled) setPartyOnlineOnly(false);
  }, [initialPrefs.watchPartyEnabled]);
  const acceptHostDub = () => {
    const host = latestHostPlayback.current;
    if (!host) return;
    dismissedHostDub.current = null;
    setSuggestedHostDub(null);
    const targetVideos = (seasonVideos[host.season] ?? []).filter(video => !video.offline);
    const source = targetVideos.find(video => video.number === host.episode && video.data.dubbing === host.dub && /kodik/i.test(video.data.player))
      ?? targetVideos.find(video => video.number === host.episode && video.data.dubbing === host.dub);
    if (!source) return setPartyDubNotice(`Озвучка «${host.dub}» недоступна для этой серии.`);
    pendingPartyPlayback.current = { ...host, player: source.data.player };
    setSelectedSeason(host.season);
    setEpisode(host.episode);
    setDub(host.dub);
    setPlayer(source.data.player);
    setAutoPlay(host.playing);
  };
  const episodeKey = `${selectedSeason}:${episode}`;
  const resumePositionFor = (key: string) => {
    const savedPosition = episodeResumePosition(savedRef.current?.episodes[key]);
    return resumeRequested && initialResumeTarget.current.episodeKey === key
      ? Math.max(savedPosition, initialResumeTarget.current.position)
      : savedPosition;
  };
  useEffect(() => {
    const synchronized = pendingPartyPlayback.current;
    const start = synchronized?.position ?? resumePositionFor(episodeKey);
    pendingResumeSeek.current = start > 5
      ? { episodeKey, target: start, expiresAt: Date.now() + 10 * 60_000, lastAttemptAt: 0 }
      : null;
  }, [current?.video_id, episodeKey]);
  const iframeSource = useMemo(() => {
    if (!current?.iframe_url || useAnimeSoulPlayer) return "";
    const synchronized = pendingPartyPlayback.current;
    const start = synchronized?.position ?? resumePositionFor(episodeKey);
    if (isKodikEmbed(current.iframe_url, current.data.player)) {
      return kodikSerialSource(current.iframe_url, String(current.originNumber ?? current.number), start);
    }
    const normalized = current.iframe_url.startsWith("//") ? `https:${current.iframe_url}` : current.iframe_url;
    if (start <= 5) return normalized;
    try {
      const url = new URL(normalized, "http://localhost");
      url.searchParams.set("start_from", String(Math.floor(start)));
      return url.toString();
    } catch {
      return normalized;
    }
  }, [current?.video_id, episodeKey, useAnimeSoulPlayer]);
  useEffect(() => {
    if (!current?.iframe_url || useAnimeSoulPlayer) {
      // During an internal Kodik episode transition React can briefly have no
      // matching API row for the new display episode. Keep the already mounted
      // iframe alive through that gap; unmounting it immediately exits native
      // fullscreen even though Kodik itself switched successfully.
      if ((playerManagedEpisodeSwitch.current || pendingPlayerEpisodeSwitch.current) && renderedIframeSource) return;
      renderedIframeIdentity.current = "";
      setRenderedIframeSource("");
      return;
    }
    if (!isKodikEmbed(current.iframe_url, current.data.player)) {
      renderedIframeIdentity.current = current.iframe_url;
      setRenderedIframeSource(iframeSource);
      return;
    }

    const identity = kodikSerialIdentity(current.iframe_url);
    const originEpisode = String(current.originNumber ?? current.number);

    // Once auto-next is delegated to the mounted Kodik serial player, never
    // navigate that iframe while React catches up with its episode/translation
    // events. Some API rows contain a different embed identity for every
    // episode, so suppressing only the first render was not enough: a later
    // render replaced the fullscreen iframe and Chromium closed fullscreen.
    if (playerManagedEpisodeSwitch.current && renderedIframeSource) {
      selectionReportedByPlayer.current = false;
      lastEpisodeCommand.current = originEpisode;
      return;
    }
    if (renderedIframeIdentity.current !== identity) {
      renderedIframeIdentity.current = identity;
      lastEpisodeCommand.current = originEpisode;
      setRenderedIframeSource(iframeSource);
      return;
    }

    // A selection made inside Kodik has already changed its own video. For a
    // selection made in AnimeSoul, command the existing serial iframe instead
    // of navigating it to another single-episode URL.
    if (lastEpisodeCommand.current !== originEpisode) {
      lastEpisodeCommand.current = originEpisode;
      command("change_episode", { episode: /^\d+$/.test(originEpisode) ? Number(originEpisode) : originEpisode });
    }
  }, [iframeSource, current?.video_id, useAnimeSoulPlayer]);
  const uniqueFranchiseVideos = Object.entries(seasonVideos).flatMap(([season, list]) => [...new Map(list.map(v => [`${season}:${v.number}`, v])).values()]), totalAcrossSeasons = uniqueFranchiseVideos.length, totalDurationAcrossSeasons = uniqueFranchiseVideos.reduce((sum, v) => sum + (v.duration ?? 0), 0), orderedEpisodeKeys = displaySeasons.flatMap(group => Array.from(new Set((seasonVideos[group.number] ?? []).filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => video.number))).sort((a, b) => +a - +b).map(number => `${group.number}:${number}`)), pendingDisplayKeys = (tracker?.pendingEpisodeKeys ?? []).flatMap(rawKey => { for (const [season, list] of Object.entries(seasonVideos)) { const match = list.find(video => `${video.originAnimeId}:${video.originNumber}` === rawKey && (!tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing))); if (match) return [`${season}:${match.number}`] ;} return [] ;}), datedEpisodeKeys = [...new Map(Object.entries(seasonVideos).flatMap(([season, list]) => list.filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => [`${video.originAnimeId}:${video.originNumber}`, { displayKey: `${season}:${video.number}`, date: video.date ?? 0 }] as const))).values()].sort((a, b) => a.date - b.date).map(item => item.displayKey), resolvedNewEpisodeKeys = pendingDisplayKeys.length ? pendingDisplayKeys : (tracker?.newEpisodes ? datedEpisodeKeys.slice(-tracker.newEpisodes) : []), newEpisodeKeys = new Set(resolvedNewEpisodeKeys);
  useEffect(() => {
    if (!newEpisodeRequested || newEpisodeOpened.current || !tracker?.newEpisodes || !resolvedNewEpisodeKeys.length) return;
    const target = resolvedNewEpisodeKeys[0];
    const separator = target.indexOf(":");
    const targetSeason = Number(target.slice(0, separator));
    const targetEpisode = target.slice(separator + 1);
    if (selectedSeason !== targetSeason) {
      setSelectedSeason(targetSeason);
      return;
    }
    const targetVideos = (seasonVideos[targetSeason] ?? []).filter(video => video.number === targetEpisode);
    const availableDubs = Array.from(new Set(targetVideos.map(video => video.data.dubbing)));
    const kodikDefault = targetVideos.find(video => isKodikEmbed(video.iframe_url, video.data.player))?.data.dubbing ?? "";
    const nextDub = preferredDubbing(availableDubs, manualDubbing, globalDubbing, favouriteDubbings, kodikDefault);
    if (!nextDub) return;
    const targetSources = targetVideos.filter(video => video.data.dubbing === nextDub && !video.offline);
    const targetHasKodik = targetSources.some(video => isKodikEmbed(video.iframe_url, video.data.player));
    const targetPlayers = Array.from(new Set([...(kodikAccessReady && targetHasKodik ? [ANIMESOUL_PLAYER] : []), ...targetSources.map(video => video.data.player)]));
    const nextPlayer = preferredPlayer(targetPlayers, titlePlayer, kodikAccessReady && targetHasKodik, targetSources[0]?.data.player);
    newEpisodeOpened.current = true;
    setDub(nextDub);
    setEpisode(targetEpisode);
    setPlayer(nextPlayer);
    setAutoPlay(true);
  }, [newEpisodeRequested, tracker?.newEpisodes, resolvedNewEpisodeKeys.join("|"), selectedSeason, seasonVideos, kodikAccessReady]);
  const scheduleRows: ReleaseScheduleRow[] = displaySeasons
    .flatMap(group => group.entries.map(entry => ({ group, entry, item: schedule[entry.anime_id] })))
    .filter((row): row is ReleaseScheduleRow => Boolean(row.item?.episodes?.next_date))
    .sort((a, b) => (a.item.episodes?.next_date ?? 0) - (b.item.episodes?.next_date ?? 0));
  const carouselItems = displaySeasons.flatMap(group => { const list = seasonVideos[group.number] ?? [], numbers = Array.from(new Set(list.map(video => video.number))).sort((a, b) => +a - +b); return numbers.map(number => { const candidates = list.filter(video => video.number === number), video = candidates.find(item => item.data.dubbing === dub) ?? candidates[0], entry = group.entries.find(item => item.anime_id === video?.originAnimeId) ?? group.entries[0]; return { season: group.number, number, group, video, entry } ;}) ;}), carouselIndex = carouselItems.findIndex(item => item.season === selectedSeason && item.number === episode), previousCarouselItem = showUpcoming ? (carouselIndex >= 0 ? carouselItems[carouselIndex] : undefined) : (carouselIndex > 0 ? carouselItems[carouselIndex - 1] : undefined), nextCarouselItem = !showUpcoming && carouselIndex >= 0 ? carouselItems[carouselIndex + 1] : undefined, upcomingRow = !nextCarouselItem ? scheduleRows.find(row => (row.item?.episodes?.next_date ?? 0) * 1000 > Date.now() - 86400000) : undefined, upcomingEpisode = upcomingRow ? Math.max(1, (upcomingRow.item?.episodes?.aired ?? (Number(episode) || 0)) + 1) : 0, upcomingTotal = upcomingRow?.item?.episodes?.count ?? 0, upcomingSeason = upcomingRow?.group.number ?? selectedSeason;
  const activePlaybackContext = () => {
    const selection = (fullscreenActive.current || isPlayerFullscreen())
      ? playbackCursor.current
      : { season: selectedSeason, episode, dub, player: effectivePlayer };
    const list = seasonVideos[selection.season] ?? [];
    const video = list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub && item.data.player === selection.player)
      ?? list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub && /kodik/i.test(item.data.player))
      ?? list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub)
      ?? list.find(item => item.number === selection.episode)
      ?? current;
    const group = seasons.find(item => item.number === selection.season) ?? selectedGroup;
    const activeSkips = selection.player === ANIMESOUL_PLAYER && video?.video_id === current?.video_id
      ? playbackSkips
      : video?.skips;
    const activeOpeningEnd = activeSkips?.opening ? activeSkips.opening.time + activeSkips.opening.length : 0;
    const activeEndingStart = activeSkips?.ending?.time ?? 0;
    const activeEndingEnd = activeSkips?.ending ? activeSkips.ending.time + activeSkips.ending.length : (video?.duration ?? 0);
    return {
      ...selection,
      key: `${selection.season}:${selection.episode}`,
      video,
      group,
      openingEnd: activeOpeningEnd,
      endingStart: activeEndingStart,
      endingEnd: activeEndingEnd,
    };
  };
  const commitProgress = (entry: { value: AnimeProgress; originEpisodeKey?: string }) => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = null;
    pendingProgress.current = null;
    lastProgressCommit.current = Date.now();
    onProgressRef.current(entry.value, entry.originEpisodeKey);
  };
  const progressTargetFor = (playback: ReturnType<typeof activePlaybackContext>) => createPlaybackProgressTarget({
    season: playback.season,
    episode: playback.episode,
    dub: playback.dub || dub,
    player: playback.player || effectivePlayer,
    seasonLabel: playback.group?.label,
    originAnimeId: playback.video?.originAnimeId,
    originEpisode: playback.video?.originNumber,
    totalEpisodes: totalAcrossSeasons || episodes.length,
    totalDuration: totalDurationAcrossSeasons || savedRef.current?.totalDuration,
    endingStart: playback.endingStart,
  });
  const saveForTarget = (
    target: PlaybackProgressTarget,
    time: number,
    duration: number,
    completed = false,
    flushImmediately = false,
  ) => {
    const { value, reachedEnd, originEpisodeKey } = recordPlaybackObservation(
      savedRef.current,
      target,
      { time, duration, completed },
    );
    savedRef.current = value;
    const entry = { value, originEpisodeKey: reachedEnd ? originEpisodeKey : undefined };
    pendingProgress.current = entry;
    const elapsed = Date.now() - lastProgressCommit.current;
    if (flushImmediately || completed || reachedEnd || elapsed >= 5000) commitProgress(entry);
    else if (!progressTimer.current) progressTimer.current = setTimeout(() => { if (pendingProgress.current) commitProgress(pendingProgress.current) ;}, 5000 - elapsed);
  };
  const save = (time: number, duration: number, completed = false) => {
    saveForTarget(progressTargetFor(activePlaybackContext()), time, duration, completed);
  };
  const localPlaybackProgressTarget = current
    ? progressTargetFor({
        season: selectedSeason,
        episode,
        dub: current.data.dubbing || dub,
        player: effectivePlayer,
        key: `${selectedSeason}:${episode}`,
        video: current,
        group: selectedGroup,
        openingEnd,
        endingStart,
        endingEnd,
      })
    : null;
  const toggleWatched = (targetSeason: number, targetEpisode: string, duration: number, video?: Video) => {
    if (pendingProgress.current) commitProgress(pendingProgress.current);
    const snapshot = savedRef.current;
    const key = `${targetSeason}:${targetEpisode}`;
    const nextEpisodeState = toggleEpisodeWatched(snapshot?.episodes[key], duration);
    const value: AnimeProgress = {
      ...(snapshot ?? {
        episode,
        dub,
        season: selectedSeason,
        seasonLabel: selectedGroup?.label,
        episodes: {},
      }),
      totalEpisodes: totalAcrossSeasons || snapshot?.totalEpisodes,
      totalDuration: totalDurationAcrossSeasons || snapshot?.totalDuration,
      episodes: {
        ...(snapshot?.episodes ?? {}),
        [key]: nextEpisodeState,
      },
    };
    savedRef.current = value;
    const originEpisodeKey = isEpisodeWatched(nextEpisodeState) && video?.originAnimeId && video.originNumber
      ? `${video.originAnimeId}:${video.originNumber}`
      : undefined;
    onProgress(value, originEpisodeKey, key);
  };
  const toggleSeasonWatched = (targetSeason: number, targetEpisodes: string[], list: Video[]) => {
    if (!targetEpisodes.length) return;
    if (pendingProgress.current) commitProgress(pendingProgress.current);
    const snapshot = savedRef.current;
    const allWatched = targetEpisodes.every(targetEpisode => isEpisodeWatched(snapshot?.episodes[`${targetSeason}:${targetEpisode}`]));
    const episodes = { ...(snapshot?.episodes ?? {}) };
    const changedEpisodeKeys: string[] = [];
    const originEpisodeKeys: string[] = [];

    targetEpisodes.forEach(targetEpisode => {
      const key = `${targetSeason}:${targetEpisode}`;
      const previous = episodes[key];
      // Marking a season keeps already watched episodes untouched, so their
      // completion counters are not incremented a second time.
      if (!allWatched && isEpisodeWatched(previous)) return;
      const video = list.find(item => item.number === targetEpisode);
      const next = toggleEpisodeWatched(previous, episodeDuration(list, targetEpisode));
      episodes[key] = next;
      changedEpisodeKeys.push(key);
      if (!allWatched && video?.originAnimeId && video.originNumber) {
        originEpisodeKeys.push(`${video.originAnimeId}:${video.originNumber}`);
      }
    });

    const value: AnimeProgress = {
      ...(snapshot ?? {
        episode,
        dub,
        season: selectedSeason,
        seasonLabel: selectedGroup?.label,
        episodes: {},
      }),
      totalEpisodes: totalAcrossSeasons || snapshot?.totalEpisodes,
      totalDuration: totalDurationAcrossSeasons || snapshot?.totalDuration,
      episodes,
    };
    savedRef.current = value;
    onProgress(value, originEpisodeKeys, changedEpisodeKeys);
  };
  const flushPendingProgress = () => {
    if (pendingProgress.current) commitProgress(pendingProgress.current);
  };
  const flushMountedLocalPlayback = () => {
    const video = localVideo.current;
    if (
      localPlaybackProgressTarget
      && video
      && Number.isFinite(video.currentTime)
      && video.currentTime > 0
    ) {
      const duration = Number.isFinite(video.duration) ? video.duration : (current?.duration ?? 0);
      saveForTarget(localPlaybackProgressTarget, video.currentTime, duration, false, true);
      return;
    }
    flushPendingProgress();
  };
  useEffect(() => () => {
    if (pendingProgress.current) commitProgress(pendingProgress.current);
    else if (progressTimer.current) clearTimeout(progressTimer.current);
  }, []);
  useEffect(() => {
    const flush = () => flushPendingProgress();
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);
  const chooseSeason = (nextSeason: number) => { flushMountedLocalPlayback(); cancelPendingPlayerEpisodeSwitch(); playerManagedEpisodeSwitch.current = false; setShowUpcoming(false); setSelectedSeason(nextSeason); setPlayer("") ;};
  const chooseEpisode = (nextEpisode: string, nextSeason = selectedSeason, scrollToPlayer = true) => { flushMountedLocalPlayback(); cancelPendingPlayerEpisodeSwitch(); playerManagedEpisodeSwitch.current = false; setShowUpcoming(false); setSelectedSeason(nextSeason); setEpisode(nextEpisode); setPlayer(""); if (scrollToPlayer && autoScrollPlayer) requestAnimationFrame(() => requestAnimationFrame(() => playerShell.current?.scrollIntoView({ behavior: "smooth", block: "start" }))) ;};
  const activateCarouselItem = (item: (typeof carouselItems)[number], direction: "previous" | "next", play = true, scrollToPlayer = true) => { setCarouselMotion(""); requestAnimationFrame(() => setCarouselMotion(direction)); setTimeout(() => setCarouselMotion(""), 520); setAutoPlay(play); chooseEpisode(item.number, item.season, scrollToPlayer) ;};
  const confirmPlayerEpisodeSwitch = () => {
    const pending = pendingPlayerEpisodeSwitch.current;
    if (!pending) return false;
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    pending.retryIds.forEach(clearTimeout);
    pendingPlayerEpisodeSwitch.current = null;
    playerManagedEpisodeSwitch.current = true;
    // The serial Kodik iframe is already showing this episode. Mark the
    // following React-state synchronization as player-originated so the
    // source/identity effect does not navigate the fullscreen iframe again.
    selectionReportedByPlayer.current = true;
    if (fullscreenActive.current || isPlayerFullscreen()) {
      fullscreenActive.current = true;
      queueFullscreenSelection({
        season: pending.displaySeason,
        episode: pending.displayEpisode,
        dub: playbackCursor.current.dub || dub,
        player: playbackCursor.current.player || current?.data.player || player,
      });
    } else {
      setShowUpcoming(false);
      setSelectedSeason(pending.displaySeason);
      setEpisode(pending.displayEpisode);
      setAutoPlay(false);
    }
    setTimeout(() => command("play"), 80);
    return true;
  };
  const switchInsideKodik = (next: (typeof carouselItems)[number]) => {
    const originEpisode = String(next.video?.originNumber ?? next.number);
    const sameOrigin = Boolean(
      current?.originAnimeId
      && next.video?.originAnimeId
      && current.originAnimeId === next.video.originAnimeId,
    );
    if (!sameOrigin || next.season !== selectedSeason || effectivePlayer === ANIMESOUL_PLAYER || !/kodik/i.test(current?.data.player ?? player)) return false;

    cancelPendingPlayerEpisodeSwitch();
    playerManagedEpisodeSwitch.current = true;
    const pending = {
      displaySeason: next.season,
      displayEpisode: next.number,
      originEpisode,
      timeoutId: undefined as ReturnType<typeof setTimeout> | undefined,
      retryIds: [] as ReturnType<typeof setTimeout>[],
    };
    pendingPlayerEpisodeSwitch.current = pending;
    const requestedEpisode = /^\d+$/.test(originEpisode) ? Number(originEpisode) : originEpisode;
    // One episode command is intentional. Retrying it after Kodik had already
    // switched recreated its internal video layer in some builds and dropped
    // native fullscreen a few seconds after an otherwise successful switch.
    command("change_episode", { episode: requestedEpisode });
    pending.retryIds.push(setTimeout(() => {
      if (pendingPlayerEpisodeSwitch.current === pending) command("play");
    }, 180));
    pending.timeoutId = setTimeout(() => {
      if (pendingPlayerEpisodeSwitch.current !== pending) return;
      // Some Kodik builds change the episode correctly but never report an
      // episode_changed/current_episode event. Never navigate the iframe here:
      // replacing a fullscreen iframe forces Chromium to leave fullscreen.
      // Commit AnimeSoul's state while keeping the same serial player alive.
      confirmPlayerEpisodeSwitch();
    }, 1_500);
    return true;
  };
  const advanceAfterPlayback = () => {
    const activeSelection = (fullscreenActive.current || isPlayerFullscreen())
      ? playbackCursor.current
      : { season: selectedSeason, episode, dub, player: effectivePlayer };
    const next = nextEpisodeInSeason(carouselItems, activeSelection.season, activeSelection.episode);
    if (!next) return;
    const transitionKey = `${activeSelection.season}:${activeSelection.episode}`;
    if (autoNextTransitionKey.current === transitionKey) return;
    autoNextTransitionKey.current = transitionKey;
    if (!switchInsideKodik(next)) activateCarouselItem(next, "next", true, false);
  };
  useEffect(() => {
    autoNextTransitionKey.current = "";
  }, [current?.video_id]);
  useEffect(() => () => cancelPendingPlayerEpisodeSwitch(), []);
  const restoreSavedPosition = (observedTime?: number) => {
    const pending = pendingResumeSeek.current;
    if (!pending || pending.episodeKey !== episodeKey) return false;
    if (typeof observedTime === "number" && observedTime >= pending.target - 3) {
      pendingResumeSeek.current = null;
      return false;
    }
    const now = Date.now();
    if (now >= pending.expiresAt) {
      pendingResumeSeek.current = null;
      return false;
    }
    if (now - pending.lastAttemptAt >= 650) {
      pending.lastAttemptAt = now;
      command("seek", { seconds: pending.target });
    }
    return true;
  };
  useEffect(() => {
    const stopPartyMotionTimer = () => {
      if (partyPauseTimer.current) clearTimeout(partyPauseTimer.current);
      partyPauseTimer.current = null;
    };
    const markPartyPaused = () => {
      stopPartyMotionTimer();
      setPartyPlaying(false);
    };
    const fn = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      let d = event.data;
      try { if (typeof d === "string") d = JSON.parse(d); } catch { return; }
      const key = d?.key ?? d?.type;
      const eventKey = String(key ?? "").toLowerCase();
      const val = d?.value ?? d;
      const reportedEpisode = playerEpisode(val);
      const isEpisodeEvent = eventKey === "kodik_player_current_episode"
        || eventKey.includes("episode_changed")
        || eventKey.includes("change_episode");
      const isDubbingEvent = eventKey.includes("translation")
        || eventKey.includes("dubbing")
        || eventKey.includes("voice");
      const reportedDubbing = playerDubbing(val);
      const reportedTranslationId = playerTranslationId(val)
        || (isDubbingEvent && (typeof val === "string" || typeof val === "number") ? String(val) : "");
      if (isEpisodeEvent && reportedEpisode) {
        const pending = pendingPlayerEpisodeSwitch.current;
        if (pending && reportedEpisode === pending.originEpisode) {
          confirmPlayerEpisodeSwitch();
        } else {
          const reportedSeason = Number(val?.season ?? val?.current_season ?? 0);
          const candidates = Object.entries(seasonVideos).flatMap(([season, list]) => list.map(video => ({ season: Number(season), video })));
          const sameOrigin = candidates.filter(({ video }) =>
            video.originAnimeId === current?.originAnimeId
            && String(video.originNumber ?? video.number) === reportedEpisode,
          );
          const seasonCandidates = reportedSeason
            ? candidates.filter(({ season, video }) => season === reportedSeason && String(video.originNumber ?? video.number) === reportedEpisode)
            : [];
          const matchPool = sameOrigin.length ? sameOrigin : (seasonCandidates.length ? seasonCandidates : candidates.filter(({ video }) => String(video.originNumber ?? video.number) === reportedEpisode));
          const match = matchPool.find(({ video }) => video.data.dubbing === dub && video.data.player === (current?.data.player ?? player))
            ?? matchPool.find(({ video }) => video.data.dubbing === dub)
            ?? matchPool[0];
          if (match && (match.video.number !== episode || match.season !== selectedSeason)) {
            playerManagedEpisodeSwitch.current = true;
            selectionReportedByPlayer.current = true;
            if (fullscreenActive.current || isPlayerFullscreen()) {
              fullscreenActive.current = true;
              queueFullscreenSelection({
                season: match.season,
                episode: match.video.number,
                dub: match.video.data.dubbing,
                player: match.video.data.player,
              });
            } else {
              setSelectedSeason(match.season);
              setEpisode(match.video.number);
              setPlayer(match.video.data.player);
            }
          }
        }
      }
      // Episode and translation are deliberately handled independently:
      // Kodik commonly reports both in one current_episode payload.
      if ((isDubbingEvent || reportedDubbing || reportedTranslationId) && (reportedDubbing || reportedTranslationId)) {
        const normalized = reportedDubbing.trim().toLocaleLowerCase();
        const reportedEpisodeVideos = reportedEpisode
          ? videos.filter(video => String(video.originNumber ?? video.number) === reportedEpisode || video.number === reportedEpisode)
          : videos;
        const pool = reportedEpisodeVideos.length ? reportedEpisodeVideos : videos;
        const target = pool.find(video => reportedTranslationId && [video.data.translation_id, video.data.player_id].some(id => id != null && String(id) === reportedTranslationId))
          ?? pool.find(video => normalized && video.data.dubbing.trim().toLocaleLowerCase() === normalized)
          ?? pool.find(video => normalized && (normalized.includes(video.data.dubbing.trim().toLocaleLowerCase()) || video.data.dubbing.trim().toLocaleLowerCase().includes(normalized)));
        if (target && target.data.dubbing !== dub) {
          // Kodik has already switched its internal translation. Move the
          // React state to that source without reloading the serial iframe.
          renderedIframeIdentity.current = kodikSerialIdentity(target.iframe_url);
          selectionReportedByPlayer.current = true;
          if (fullscreenActive.current || isPlayerFullscreen()) {
            fullscreenActive.current = true;
            queueFullscreenSelection({
              season: playbackCursor.current.season,
              episode: playbackCursor.current.episode,
              dub: target.data.dubbing,
              player: target.data.player,
            });
          } else {
            setDub(target.data.dubbing);
            setPlayer(target.data.player);
          }
        }
      }
      if (key === "kodik_player_time_update") {
        const time = Number(val.time ?? val.currentTime ?? val);
        const playback = activePlaybackContext();
        const duration = Number(val.duration ?? playback.video?.duration ?? 0);
        if (Number.isFinite(time)) {
          // A reset to the beginning confirms that Kodik really changed the
          // episode, including builds that do not send current_episode.
          if (pendingPlayerEpisodeSwitch.current && time >= 0 && time < 15) {
            confirmPlayerEpisodeSwitch();
            return;
          }
          if (initialPrefs.watchPartyEnabled) {
            const moved = time > lastPartyTime.current + .04;
            lastPartyTime.current = time;
            setPartyTime(time);
            setPartyDuration(duration);
            if (moved) {
              lastPartyMotionAt.current = Date.now();
              setPartyPlaying(true);
              stopPartyMotionTimer();
              partyPauseTimer.current = setTimeout(() => {
                if (Date.now() - lastPartyMotionAt.current >= 2_100) setPartyPlaying(false);
              }, 2_200);
            }
          }
          const restoring = restoreSavedPosition(time);
          if (!restoring) save(time, duration);
          if (autoSkip && playback.openingEnd && time >= playback.video!.skips!.opening!.time && time < playback.openingEnd) command("seek", { seconds: playback.openingEnd });
          if (autoSkipEnding && playback.endingStart && time >= playback.endingStart && time < playback.endingEnd) {
            save(playback.endingStart, duration, true);
            // Seeking to the exact end does not always make the embedded
            // Kodik player emit `video_ended` (notably in fullscreen). When
            // fullscreen is active, leave the serial transition to Kodik
            // itself. Calling change_episode from the parent is what makes
            // Chromium leave iframe fullscreen. Outside fullscreen AnimeSoul
            // keeps the existing fallback for players without native auto-next.
            if (autoNext && (!isPlayerFullscreen() || hasStableFullscreenOwner())) {
              advanceAfterPlayback();
              return;
            }
            command("seek", { seconds: playback.endingEnd });
          }
          // Kodik does not consistently emit video_ended. Start the same
          // transition from its final time update as a reliable fallback.
          if (autoNext && duration > 0 && time >= Math.max(0, duration - 1.25) && (!isPlayerFullscreen() || hasStableFullscreenOwner())) advanceAfterPlayback();
        }
      } else if (eventKey.includes("ready") || eventKey.includes("loaded")) {
        restoreSavedPosition();
      }
      if (eventKey === "play" || eventKey.endsWith("_play") || eventKey.includes("video_play")) {
        restoreSavedPosition();
        if (initialPrefs.watchPartyEnabled) {
          lastPartyMotionAt.current = Date.now();
          setPartyPlaying(true);
        }
      } else if (initialPrefs.watchPartyEnabled && eventKey.includes("pause")) {
        markPartyPaused();
      }
      if (key === "kodik_player_video_ended" || key === "ended") {
        if (initialPrefs.watchPartyEnabled) markPartyPaused();
        const playback = activePlaybackContext();
        save(Number(playback.video?.duration ?? 0), Number(playback.video?.duration ?? 0), true);
        // Keep the same serial iframe document and switch through its API.
        // Replacing/navigating the iframe would make Chromium leave fullscreen.
        // In fullscreen Kodik owns the serial transition; AnimeSoul observes
        // the new episode but deliberately does not mutate the surrounding UI.
        if (autoNext && (!isPlayerFullscreen() || hasStableFullscreenOwner())) advanceAfterPlayback();
      }
    };
    window.addEventListener("message", fn);
    return () => {
      window.removeEventListener("message", fn);
      stopPartyMotionTimer();
    };
  }, [episode, dub, autoNext, autoSkip, autoSkipEnding, openingEnd, endingStart, endingEnd, current?.video_id, carouselIndex, carouselItems.length, initialPrefs.watchPartyEnabled]);
  const loaded = () => {
    if (current?.offline) setLocalPlaybackReady(true);
    const synchronized = pendingPartyPlayback.current;
    const start = synchronized?.position ?? resumePositionFor(episodeKey);
    pendingResumeSeek.current = start > 5 ? { episodeKey, target: start, expiresAt: Date.now() + 10 * 60_000, lastAttemptAt: 0 } : null;
    [250, 700, 1_300, 2_800, 5_000, 8_000].forEach(delay => setTimeout(() => restoreSavedPosition(), delay));
    setTimeout(() => {
      if (synchronized?.playing || autoPlay || (resumeRequested && autoPlayResume)) {
        command("play");
        setAutoPlay(false);
      } else if (synchronized) command("pause");
      pendingPartyPlayback.current = null;
    }, 700);
  };
  const localTimeUpdated = (reportedTime?: number, reportedDuration?: number) => {
    const video = localVideo.current;
    if (!video || !localPlaybackProgressTarget || (!current?.offline && !useAnimeSoulPlayer)) return;
    const time = Number.isFinite(reportedTime) ? Number(reportedTime) : video.currentTime;
    const duration = Number.isFinite(reportedDuration)
      ? Number(reportedDuration)
      : Number.isFinite(video.duration) ? video.duration : (current?.duration ?? 0);
    if (initialPrefs.watchPartyEnabled) {
      setPartyTime(time);
      setPartyDuration(duration);
      setPartyPlaying(!video.paused);
    }
    const restoring = restoreSavedPosition(time);
    if (!restoring) saveForTarget(localPlaybackProgressTarget, time, duration);
    if (autoSkip && playbackSkips.opening && time >= playbackSkips.opening.time && time < openingEnd) command("seek", { seconds: openingEnd });
    if (autoSkipEnding && endingStart > 0 && time >= endingStart && time < endingEnd) {
      saveForTarget(localPlaybackProgressTarget, endingStart, duration, true);
      if (autoNext) advanceAfterPlayback();
      else command("seek", { seconds: endingEnd });
    }
  };
  const localEnded = (reportedDuration?: number) => {
    const duration = Number.isFinite(reportedDuration)
      ? Number(reportedDuration)
      : localVideo.current?.duration || current?.duration || 0;
    if (localPlaybackProgressTarget) saveForTarget(localPlaybackProgressTarget, duration, duration, true);
    setPartyPlaying(false);
    if (autoNext) advanceAfterPlayback();
  };
  const queueDownloadVideos = async (
    selectedVideos: (Video & { __season: number })[],
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
        ? { sourceId: String(remoteIds.shikimori_id), sourceIdType: "shikimori" }
        : remoteIds?.kp_id
          ? { sourceId: String(remoteIds.kp_id), sourceIdType: "kinopoisk" }
          : undefined;
      return {
        videoId: video.video_id,
        season: video.__season,
        seasonLabel: downloadCandidates.find(item => item.key === `${video.__season}:${video.number}`)?.seasonLabel,
        episode: video.number,
        originAnimeId: video.originAnimeId,
        originEpisode: video.originNumber,
        dubbing: video.data.dubbing,
        // Yummy's player id is not Kodik's translation id. The explicit
        // translation field is the only safe value to forward here.
        translationId: video.data.translation_id,
        iframeUrl: video.iframe_url,
        ...sourceReference,
        sourceTitle: previewAnime.title,
        sourceOriginalTitle: previewAnime.original ?? previewAnime.title_en,
        duration: video.duration,
        previewUrl: episodePreviewImages(previewAnime, video.originNumber ?? video.number)[0],
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
      setDownloadNotice(error instanceof Error ? error.message : "Не удалось добавить загрузку в очередь.");
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
      .filter((video): video is Video & { __season: number } => Boolean(video));
    return queueDownloadVideos(selected);
  };
  const cancelActiveDownload = async (jobId: string) => {
    const job = downloadJobs.find(item => item.id === jobId);
    if (!job || !["queued", "downloading", "paused"].includes(job.status) || isCancellingDownload) return;

    try {
      setIsCancellingDownload(true);
      setDownloadNotice("Отменяем скачивание…");
      await cancelDownload(job.id);
      setDownloadJobs(current => current.map(item => item.id === job.id
        ? { ...item, status: "cancelled", error: "" }
        : item));
      setDownloadNotice("Скачивание отменено. Недокачанный файл удалён.");
    } catch (error) {
      setDownloadNotice(error instanceof Error ? error.message : "Не удалось отменить скачивание.");
    } finally {
      setIsCancellingDownload(false);
    }
  };
  const primaryDownloadJob = activeDownloadJobs.find(job => job.status === "downloading" || job.status === "paused")
    ?? [...activeDownloadJobs].sort((left, right) => (left.queuePosition ?? 999) - (right.queuePosition ?? 999))[0]
    ?? downloadJobs[0];
  const downloadIsActive = activeDownloadJobs.length > 0;
  const visibleDownloadNotice = downloadNotice || (primaryDownloadJob ? downloadJobText(primaryDownloadJob) : "");
  const setToolbar = (p: ToolbarPosition) => { setPosition(p); write(K.toolbar, p) ;};
  const chooseDubbing = (value: string) => {
    if (!dubbingHasEpisode(voiceVideos, value, episode)) return;
    const currentProviderDefault = voiceVideos
      .filter(video => video.number === episode)
      .find(video => isKodikEmbed(video.iframe_url, video.data.player))?.data.dubbing ?? "";
    const localSource = partyOnlineOnly
      ? undefined
      : preferredOfflineVideo(videos, value, episode, downloadQuality);
    setDub(value);
    const nextManualDubbings = { ...(initialPrefs.titleDubbings ?? {}) };
    const automatic = preferredDubbing(
      Array.from(new Set(voiceVideos.filter(video => video.number === episode).map(video => video.data.dubbing))),
      "",
      globalDubbing,
      favouriteDubbings,
      currentProviderDefault,
    );
    if (value === automatic) delete nextManualDubbings[titlePreferenceKey];
    else nextManualDubbings[titlePreferenceKey] = value;
    patchPrefs({ titleDubbings: nextManualDubbings, dubbingPreferenceVersion: 2 });
    // Downloaded media wins whenever the user returns to its dubbing.
    // Active watch-party sessions deliberately omit every local source.
    setPlayer(localSource?.data.player ?? "");
  };
  const toggleDubbingFavorite = () => {
    const next = favouriteDubbings.includes(dub)
      ? favouriteDubbings.filter(value => value !== dub)
      : [...favouriteDubbings, dub];
    patchPrefs({ favoriteDubbings: next });
  };
  const toggleGlobalDubbing = () => {
    const next = { ...(initialPrefs.titleDubbings ?? {}) };
    delete next[titlePreferenceKey];
    patchPrefs({
      preferredDubbing: globalDubbing === dub ? "" : dub,
      titleDubbings: next,
      dubbingPreferenceVersion: 2,
    });
  };
  const chooseSource = (value: string) => {
    playerManagedEpisodeSwitch.current = false;
    setPlayer(value);
    patchPrefs({
      titlePlayers: {
        ...(initialPrefs.titlePlayers ?? {}),
        [titlePreferenceKey]: value,
      },
    });
  };
  const partyPanel = (
    <WatchPartyPanel
      enabled={initialPrefs.watchPartyEnabled}
      panelPosition={initialPrefs.watchPartyPanelPosition}
      personalMode={initialPrefs.watchPartyMode}
      roomMode={initialPrefs.watchPartyRoomMode}
      party={party}
      roomCode={partyRoomCode}
      onRoomCodeChange={setPartyRoomCode}
      onRoomModeChange={watchPartyRoomMode => persistPrefs({ ...initialPrefs, watchPartyRoomMode })}
      suggestedHostDub={suggestedHostDub}
      onAcceptHostDub={acceptHostDub}
      onDismissHostDub={() => {
        dismissedHostDub.current = suggestedHostDub;
        setSuggestedHostDub(null);
      }}
      dubbingNotice={partyDubNotice}
      isKodikSource={/kodik/i.test(current?.data.player ?? player)}
    />
  );
  return <main className="app">{header}
    <section className="watch-shell"><button className="back" onClick={onBack}>← Каталог</button>
      <div className="watch-heading"><div><span className="eyebrow">{showUpcoming && upcomingRow ? `${upcomingRow.group.label?.toUpperCase() ?? `СЕЗОН ${upcomingSeason}`} · СЕРИЯ ${upcomingEpisode}` : `${selectedGroup?.label?.toUpperCase() ?? `СЕЗОН ${selectedSeason}`} · ${current?.contentKind ?? (selectedGroup?.kind === "movie" ? "ФИЛЬМ" : "СЕРИЯ")} ${episode}`}</span><h1>{base}</h1></div></div>
      <section className="watch-rating-panel watch-rating-desktop" aria-label="Оценки аниме">
        <div><span className="eyebrow">ОЦЕНКИ</span><RatingBoard anime={anime} ratings={ratings} communityRating={communityRating} /></div>
        <ScorePicker
          value={ratings?.anime}
          label="Ваша оценка аниме"
          onChange={value => onRatingChange({ scope: "anime" }, value)}
        />
      </section>
      <div className="season-tabs">{displaySeasons.map(s => <button className={`${s.number === selectedSeason ? "active " : ""}${s.kind === "special" ? "extra" : ""}`.trim()} key={s.number} onClick={() => chooseSeason(s.number)}>{s.label ?? `Сезон ${s.number}`}</button>)}</div>
      {seasonLoadNotice && (
        <div className="season-load-notice" role="status" aria-live="polite">
          <div className="season-load-notice-copy">
            <span>{seasonLoadNotice}</span>
            {showSourceLoadIssues && sourceLoadIssues.length > 0 && (
              <ul className="season-source-details" aria-label="Подробности загрузки источников">
                {sourceLoadIssues.map(issue => (
                  <li key={issue.key}>
                    <strong>{issue.context}</strong>
                    <span>{issue.sourceLabel}: не загрузились {issue.unavailableData} — {issue.reason}.</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="season-load-notice-actions">
            {sourceLoadIssues.length > 0 && (
              <button
                type="button"
                aria-expanded={showSourceLoadIssues}
                onClick={() => setShowSourceLoadIssues(value => !value)}
              >
                {showSourceLoadIssues ? "Скрыть" : "Подробности"}
              </button>
            )}
            <button type="button" onClick={() => void fetchVideos(true)}>Повторить</button>
          </div>
        </div>
      )}
      <div ref={playerShell} className={`episode-carousel ${episodeCarousel ? "enabled" : "disabled"} ${carouselMotion ? `shift-${carouselMotion}` : ""}`}>{episodeCarousel && previousCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-previous" images={episodePreviewImages(previousCarouselItem.entry, previousCarouselItem.video?.originNumber ?? previousCarouselItem.number)} fallback={previousCarouselItem.entry?.poster?.fullsize ?? previousCarouselItem.entry?.poster?.big} label={previousCarouselItem.group.label ?? `Сезон ${previousCarouselItem.season}`} sublabel={`${previousCarouselItem.video?.contentKind ?? "Серия"} ${previousCarouselItem.number}`} onClick={() => activateCarouselItem(previousCarouselItem, "previous")} /> : episodeCarousel ? <span className="carousel-space" /> : null}
      {initialPrefs.watchPartyPanelPosition === "top" && partyPanel}
      <div className={`video-layout ${showUpcoming ? "upcoming-layout" : useAnimeSoulPlayer && !initialPrefs.customPlayerToolbarVisible ? "toolbar-none" : `toolbar-${position}`}`}>
      <div ref={playerFrame} className={`player-frame ${showUpcoming ? "upcoming-frame" : ""}`}>
        {showUpcoming && upcomingRow ? (
          <div className="upcoming-player">
            <span>СЛЕДУЮЩАЯ СЕРИЯ</span>
            <b>{upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия {upcomingEpisode}{upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}</b>
            <time>{formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}</time>
            <small>{upcomingRow.item?.episodes?.aired ?? 0} серий уже вышло · следующая ещё недоступна</small>
          </div>
        ) : (
          <>
            {useAnimeSoulPlayer && playerStreamRequest ? (
              // Keep this instance mounted while its request changes: the
              // shell owns fullscreen and the player swaps media in place.
              <AnimeSoulPlayer
                ref={localVideo}
                request={playerStreamRequest}
                title={base}
                seasonLabel={selectedGroup?.label ?? `Сезон ${selectedSeason}`}
                episodeLabel={`${current?.contentKind ?? (selectedGroup?.kind === "movie" ? "Фильм" : "Серия")} ${episode}`}
                localPlayback={Boolean(current?.offline)}
                menu={{
                  dubbings: dubbingOptions,
                  dubbing: dub,
                  onDubbingChange: chooseDubbing,
                  dubbingFavorite: favouriteDubbings.includes(dub),
                  onDubbingFavoriteToggle: toggleDubbingFavorite,
                  dubbingGloballyPreferred: globalDubbing === dub,
                  onDubbingGloballyPreferredToggle: toggleGlobalDubbing,
                  seasons: displaySeasons.map(group => ({ value: String(group.number), label: group.label ?? `Сезон ${group.number}` })),
                  season: String(selectedSeason),
                  onSeasonChange: value => chooseSeason(Number(value)),
                  episodes: episodeOptions,
                  episode,
                  onEpisodeChange: chooseEpisode,
                  sources: players.map(value => ({ value, label: value })),
                  source: effectivePlayer,
                  onSourceChange: chooseSource,
                  subtitles: subtitleStreamOptions,
                  externalToolbarVisible: initialPrefs.customPlayerToolbarVisible,
                  onExternalToolbarVisibleChange: customPlayerToolbarVisible => patchPrefs({ customPlayerToolbarVisible }),
                }}
                opening={playbackSkips.opening}
                ending={playbackSkips.ending}
                onLoadedMetadata={loaded}
                onTimeUpdate={localTimeUpdated}
                onBeforeTeardown={(time, duration) => {
                  if (localPlaybackProgressTarget && time > 0) {
                    saveForTarget(localPlaybackProgressTarget, time, duration, false, true);
                  } else {
                    flushPendingProgress();
                  }
                }}
                onPlay={() => setPartyPlaying(true)}
                onPause={() => setPartyPlaying(false)}
                onEnded={localEnded}
                onStreamInfo={info => setDirectStreamInfo({ key: directPlaybackKey, info })}
                onFallback={current?.offline ? undefined : () => {
                  const fallback = kodikSource?.data.player ?? providerPlayers[0] ?? "";
                  setPlayer(fallback);
                  patchPrefs({
                    titlePlayers: {
                      ...(initialPrefs.titlePlayers ?? {}),
                      [titlePreferenceKey]: fallback,
                    },
                  });
                }}
              />
            ) : (current || renderedIframeSource) && (
              <iframe
                ref={iframe}
                src={renderedIframeSource || iframeSource}
                onLoad={loaded}
                title={`${base}, ${selectedGroup?.label ?? `серия ${episode}`}`}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            )}
            {current && !current.offline && !useAnimeSoulPlayer && isKodikEmbed(current.iframe_url, current.data.player) && (
              <button type="button" tabIndex={-1} aria-label="Полный экран" className="fullscreen-bridge" onClick={toggleStableFullscreen} />
            )}
            {status && !current && (
              <div className="player-status">
                <span>{status}</span>
                {!current && !status.includes("Загружаем") && !status.includes("Проверяем") && <button onClick={() => void fetchVideos(true)}>Повторить загрузку</button>}
              </div>
            )}
          </>
        )}
      </div>
      {!showUpcoming && (!useAnimeSoulPlayer || initialPrefs.customPlayerToolbarVisible) && (
        <PlayerToolbar
          dubbings={dubs}
          dubbing={dub}
          favoriteDubbings={favouriteDubbings}
          preferredDubbing={globalDubbing}
          onDubbingChange={chooseDubbing}
          dubbingFavorite={favouriteDubbings.includes(dub)}
          onDubbingFavoriteToggle={toggleDubbingFavorite}
          dubbingGloballyPreferred={globalDubbing === dub}
          onDubbingGloballyPreferredToggle={toggleGlobalDubbing}
          episodes={episodeOptions}
          episode={episode}
          onEpisodeChange={chooseEpisode}
          sources={players}
          source={effectivePlayer}
          onSourceChange={chooseSource}
          openingLabel={openingEnd > 0 ? `Пропустить опенинг → ${formatTime(openingEnd)}` : undefined}
          endingLabel={endingStart > 0 ? `Пропустить эндинг → ${formatTime(endingEnd)}` : undefined}
          onSkipOpening={() => command("seek", { seconds: openingEnd })}
          onSkipEnding={() => {
            save(endingStart, current?.duration ?? 0, true);
            command("seek", { seconds: endingEnd });
          }}
          autoSkipOpening={autoSkip}
          onAutoSkipOpeningChange={value => {
            setAutoSkipState(value);
            patchPrefs({ autoSkipOpening: value });
          }}
          autoSkipEnding={autoSkipEnding}
          onAutoSkipEndingChange={value => {
            setAutoSkipEndingState(value);
            patchPrefs({ autoSkipEnding: value });
          }}
          autoNext={autoNext}
          onAutoNextChange={value => {
            setAutoNextState(value);
            patchPrefs({ autoNext: value });
          }}
          autoScrollPlayer={autoScrollPlayer}
          onAutoScrollPlayerChange={value => {
            setAutoScrollPlayerState(value);
            patchPrefs({ autoScrollPlayer: value });
          }}
          episodeCarousel={episodeCarousel}
          onEpisodeCarouselChange={value => {
            setEpisodeCarousel(value);
            patchPrefs({ playerEpisodeCarousel: value });
          }}
          episodeHoverPreview={episodeHoverPreview}
          onEpisodeHoverPreviewChange={value => {
            setEpisodeHoverPreview(value);
            patchPrefs({ episodeHoverPreview: value }, value);
          }}
          prefs={initialPrefs}
          onPrefsChange={patchPrefs}
          position={position}
          onPositionChange={setToolbar}
        />
      )}</div>
      {initialPrefs.watchPartyPanelPosition === "overlay" && partyPanel}
      {episodeCarousel && (nextCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-next" images={episodePreviewImages(nextCarouselItem.entry, nextCarouselItem.video?.originNumber ?? nextCarouselItem.number)} fallback={nextCarouselItem.entry?.poster?.fullsize ?? nextCarouselItem.entry?.poster?.big} label={nextCarouselItem.group.label ?? `Сезон ${nextCarouselItem.season}`} sublabel={`${nextCarouselItem.video?.contentKind ?? "Серия"} ${nextCarouselItem.number}`} onClick={() => activateCarouselItem(nextCarouselItem, "next")} /> : upcomingRow && !showUpcoming ? <EpisodeSlideshow className="carousel-side carousel-next upcoming-preview" images={episodePreviewImages(upcomingRow.entry)} fallback={upcomingRow.entry.poster?.fullsize ?? upcomingRow.entry.poster?.big} label={`${upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия ${upcomingEpisode}${upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}`} sublabel={`Выйдет ${formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}`} onClick={() => { setCarouselMotion("next"); setShowUpcoming(true); setTimeout(() => setCarouselMotion(""), 520) ;}} /> : <span className="carousel-space" />)}</div>
      <section className="watch-rating-panel watch-rating-mobile" aria-label="Оценки аниме">
        <div><span className="eyebrow">ОЦЕНКИ</span><RatingBoard anime={anime} ratings={ratings} communityRating={communityRating} /></div>
        <ScorePicker
          value={ratings?.anime}
          label="Ваша оценка аниме"
          onChange={value => onRatingChange({ scope: "anime" }, value)}
        />
      </section>
      {initialPrefs.watchPartyPanelPosition === "bottom" && partyPanel}
      <WatchInfo
        anime={anime}
        seasons={displaySeasons}
        seasonVideos={seasonVideos}
        dubs={dubs}
        activeDub={dub}
        familyTitle={familyRoot}
        favorite={favorite}
        tracker={tracker}
        totalEpisodes={totalAcrossSeasons}
        totalDuration={totalDurationAcrossSeasons}
        downloadAvailable={kodikAccessReady}
        downloadActive={downloadIsActive}
        downloadStatus={visibleDownloadNotice}
        onGenre={onGenre}
        onFavorite={onFavorite}
        onFolders={onFolders}
        onDownload={() => setDownloadPickerOpen(true)}
        onTrack={onTrack}
        onUntrack={onUntrack}
        onResetProgress={onProgress}
      />
      <ReleaseSchedule rows={scheduleRows} />
      <SeasonList
        seasons={displaySeasons}
        seasonVideos={seasonVideos}
        saved={saved}
        ratings={ratings}
        communityRating={communityRating}
        schedule={schedule}
        collapsedSeasons={collapsedSeasons}
        selectedSeason={selectedSeason}
        selectedEpisode={episode}
        previewAnimeById={previewAnimeById}
        episodeHoverPreview={episodeHoverPreview}
        compactEpisodeList={initialPrefs.compactEpisodeList}
        newEpisodeKeys={newEpisodeKeys}
        onToggleSeason={toggleSeason}
        onToggleSeasonWatched={toggleSeasonWatched}
        onChooseEpisode={chooseEpisode}
        onToggleWatched={toggleWatched}
        onSeasonRatingChange={(season, value) => onRatingChange({ scope: "season", season }, value)}
        onEpisodeRatingChange={(season, ratedEpisode, value) => onRatingChange({ scope: "episode", season, episode: ratedEpisode }, value)}
      />
    </section>
    <DownloadPicker
      open={downloadPickerOpen}
      title={anime.title}
      candidates={downloadCandidates}
      dubbings={downloadDubbings}
      dubbing={effectiveDownloadDubbing}
      quality={downloadQuality}
      qualities={downloadQualityOptions}
      initialKey={`${selectedSeason}:${episode}`}
      jobs={activeDownloadJobs}
      busy={isSubmittingDownload}
      notice={downloadNotice}
      onClose={() => setDownloadPickerOpen(false)}
      onDubbingChange={setDownloadDubbing}
      onQualityChange={value => {
        setDownloadQuality(value);
        write("animesoul:download-quality", value);
      }}
      onSubmit={requestSelectedDownloads}
      onCancelJob={jobId => void cancelActiveDownload(jobId)}
    />
    {folderPicker && <FolderPicker anime={folderPicker} folders={folders} onToggle={toggleFolder} onCreate={createFolder} onClose={closePicker} />}
  </main>;
}
