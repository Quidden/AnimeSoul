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
import { RatingBoard } from "./RatingBoard";
import { ScorePicker } from "./ScorePicker";
import { enqueueDownload, fetchOfflineLibrary, type DownloadJob, type OfflineAnime } from "../lib/downloads";

function downloadJobText(job: DownloadJob) {
  const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  if (job.status === "queued") return `В очереди: ${job.total} сер. · ожидает начала`;
  if (job.status === "downloading") {
    const current = job.current || "Подготавливаем загрузку";
    return `Скачивается: ${current} · ${percent}% · ${Math.min(job.completed + 1, job.total)} из ${job.total}`;
  }
  if (job.status === "completed") return `Готово: скачано ${job.completed || job.total} сер.`;
  if (job.status === "cancelled") return "Загрузка отменена";
  return `Ошибка загрузки: ${job.error || "не удалось получить серию"}`;
}

function downloadJobLabel(status: DownloadJob["status"]) {
  if (status === "queued") return "В очереди";
  if (status === "downloading") return "Скачивается";
  if (status === "completed") return "Готово";
  if (status === "cancelled") return "Отменено";
  return "Ошибка";
}

export function Watch({ header, anime, resumeRequested, newEpisodeRequested, favorite, onFavorite, onBack, onLibrary, onGenre, saved, ratings, communityRating, onRatingChange, onProgress, onPlayerPrefsChange, onFolders, tracker, onTrack, onUntrack, folderPicker, folders, toggleFolder, createFolder, closePicker }: WatchProps) {
  const initialPrefs = { ...DEFAULT_PLAYER_PREFS, ...read<Partial<PlayerPrefs>>(K.playerPrefs, {}) };
  const storedResumePoint = resumeRequested ? latestResumePoint(saved) : null;
  const resumeSeason = storedResumePoint?.season ?? saved?.season ?? 1;
  const resumeEpisode = storedResumePoint?.episode ?? saved?.episode ?? "1";
  const topLevelResumeKey = `${saved?.season ?? 1}:${saved?.episode ?? "1"}`;
  const resumeUsesTopLevelOrigin = !storedResumePoint || storedResumePoint.key === topLevelResumeKey;
  const resumeOriginAnimeId = storedResumePoint?.state.originAnimeId
    ?? (resumeUsesTopLevelOrigin ? saved?.originAnimeId : undefined);
  const resumeOriginEpisode = storedResumePoint?.state.originEpisode
    ?? (resumeUsesTopLevelOrigin ? saved?.originEpisode : undefined);
  const [dub, setDub] = useState(saved?.dub ?? ""), [episode, setEpisode] = useState(resumeEpisode), [player, setPlayer] = useState(""), [autoNext, setAutoNextState] = useState(initialPrefs.autoNext), [autoSkip, setAutoSkipState] = useState(initialPrefs.autoSkipOpening), [autoSkipEnding, setAutoSkipEndingState] = useState(initialPrefs.autoSkipEnding), [autoPlayResume, setAutoPlayResumeState] = useState(initialPrefs.autoPlayResume), [autoScrollPlayer, setAutoScrollPlayerState] = useState(initialPrefs.autoScrollPlayer), [episodeCarousel, setEpisodeCarousel] = useState(initialPrefs.playerEpisodeCarousel), [status, setStatus] = useState("Загружаем серии…"), [position, setPosition] = useState<ToolbarPosition>(read(K.toolbar, "bottom")), [autoPlay, setAutoPlay] = useState(false), [seasons, setSeasons] = useState<SeasonGroup[]>([{ number: 1, entries: [anime] }]), [selectedSeason, setSelectedSeason] = useState(resumeSeason), [seasonVideos, setSeasonVideos] = useState<Record<number, Video[]>>({}), [schedule, setSchedule] = useState<Record<number, ScheduleEntry>>({}), [showUpcoming, setShowUpcoming] = useState(false), [carouselMotion, setCarouselMotion] = useState<"" | "previous" | "next">("");
  const [episodeHoverPreview, setEpisodeHoverPreview] = useState(initialPrefs.episodeHoverPreview);
  const [offlineAnime, setOfflineAnime] = useState<OfflineAnime | null>(null);
  const [downloadQuality, setDownloadQuality] = useState<number>(read("animesoul:download-quality", 720));
  const [downloadJob, setDownloadJob] = useState<DownloadJob | null>(null);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState("");
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
  const command = (method: string, extra: Record<string, unknown> & { seconds?: number } = {}) => {
    const video = localVideo.current;
    if (current?.offline && video) {
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
    let stopped = false;
    const refresh = () => {
      fetchOfflineLibrary()
        .then(library => {
          if (!stopped) {
            setOfflineAnime(library.anime.find(item => item.animeId === anime.anime_id) ?? null);
            setDownloadJob(current => current ? library.jobs.find(job => job.id === current.id) ?? current : null);
          }
        })
        .catch(() => {
          if (!stopped) setOfflineAnime(null);
        });
    };
    refresh();
    const downloadIsActive = downloadJob?.status === "queued" || downloadJob?.status === "downloading";
    const timer = window.setInterval(refresh, downloadIsActive ? 750 : 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [anime.anime_id, downloadJob?.id, downloadJob?.status]);

  useEffect(() => {
    if (!downloadJob || (downloadJob.status !== "completed" && downloadJob.status !== "cancelled" && downloadJob.status !== "error")) return;
    const jobId = downloadJob.id;
    const timer = window.setTimeout(() => setDownloadJob(current => current?.id === jobId ? null : current), 8500);
    return () => window.clearTimeout(timer);
  }, [downloadJob?.id, downloadJob?.status]);
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
        offline: {
          episodeId: item.id,
          quality: item.quality,
          mediaUrl: item.mediaUrl,
          previewUrl: item.previewUrl,
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
  useEffect(() => { fetchFamily(anime, familyRoot).then(found => { const source = found.length ? found : [anime], series = source.filter(a => !isMovieAnime(a) && !isExtraAnime(a)), movies = source.filter(isMovieAnime), extras = source.filter(isExtraAnime), arcs = new Map<string, Anime[]>(); for (const item of series) { const arc = stripPart(item.title); arcs.set(arc, [...(arcs.get(arc) ?? []), item]) ;} const seasonGroups = [...arcs.entries()].sort(([, a], [, b]) => (Math.min(...a.map(x => x.data?.index ?? 9999)) - Math.min(...b.map(x => x.data?.index ?? 9999))) || (Math.min(...a.map(x => x.year ?? 9999)) - Math.min(...b.map(x => x.year ?? 9999)))).map(([, entries], index): SeasonGroup => ({ number: 0, entries: [...entries].sort(byViewingOrder), label: `Сезон ${index + 1}`, kind: "season" })), extraGroups = extras.sort(byViewingOrder).map((entry): SeasonGroup => ({ number: 0, entries: [entry], label: `${isOvaAnime(entry) ? "OVA" : entry.type?.alias === "ona" ? "ONA" : "Спецвыпуск"} · ${shortEntryTitle(entry.title, familyRoot)}`, kind: "special" })), movieGroups = movies.sort(byViewingOrder).map((entry): SeasonGroup => ({ number: 0, entries: [entry], label: `Фильм · ${shortEntryTitle(entry.title, familyRoot)}`, kind: "movie" })), groups = [...seasonGroups, ...extraGroups, ...movieGroups].sort((a, b) => byViewingOrder(a.entries[0], b.entries[0])).map((group, index) => ({ ...group, number: index + 1 })); if (groups.length) { setSeasons(groups); const originGroup = resumeOriginAnimeId ? groups.find(g => g.entries.some(e => e.anime_id === resumeOriginAnimeId)) : undefined, savedSeason = resumeSeason; const selected = originGroup?.number ?? (savedSeason && groups.some(g => g.number === savedSeason) ? savedSeason : groups.find(g => g.entries.some(e => e.anime_id === anime.anime_id))?.number ?? groups[0].number); setSelectedSeason(selected) ;} }).catch(() => { }) ;}, [anime.anime_id, familyRoot]);
  const previewAnimeIds = useMemo(() => [...new Set(seasons.flatMap(group => group.entries.map(entry => entry.anime_id)))], [seasons]);
  useEffect(() => {
    if (!previewAnimeIds.length) return;
    let cancelled = false;
    Promise.all(Array.from({ length: 3 }, () =>
      fetch(`/api/yummy?mode=details&ids=${previewAnimeIds.join(",")}`).then(response => response.json()),
    ))
      .then(payloads => {
        if (cancelled) return;
        const merged = new Map<number, Anime>();
        for (const payload of payloads) {
          for (const entry of (payload.anime ?? []) as Anime[]) {
            const previous = merged.get(entry.anime_id);
            const screenshots = [...(previous?.random_screenshots ?? []), ...(entry.random_screenshots ?? [])];
            const uniqueScreenshots = [...new Map(screenshots.map(screenshot => [
              screenshot.id ?? `${screenshot.episode}:${screenshot.time}:${screenshot.sizes?.full ?? screenshot.sizes?.small}`,
              screenshot,
            ])).values()];
            merged.set(entry.anime_id, { ...(previous ?? {}), ...entry, random_screenshots: uniqueScreenshots });
          }
        }
        setPreviewAnimeById(Object.fromEntries(merged));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [previewAnimeIds.join(",")]);
  useEffect(() => { fetch("/api/yummy?mode=schedule").then(r => r.json()).then(p => setSchedule(Object.fromEntries(((p.schedule ?? []) as ScheduleEntry[]).map(item => [item.anime_id, item])))).catch(() => { }) ;}, []);
  const fetchVideos = async () => { const loadId = ++videoLoadId.current; setStatus("Загружаем сезоны…"); try { const loaded = await Promise.all(seasons.map(async group => { const ordered = [...group.entries].sort(byViewingOrder), payloads = await Promise.all(ordered.map(async entry => { for (let attempt = 0; attempt < 4; attempt++) { const r = await fetch(`/api/yummy?mode=videos&id=${entry.anime_id}`), p = await r.json(); if (r.ok) return { entry, list: p.videos as Video[] }; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1))) ;} return { entry, list: [] as Video[] } ;})); let offset = 0; const normalized = payloads.flatMap(({ entry, list }) => { const kind: Video["contentKind"] = group.kind === "movie" ? "Фильм" : isOvaAnime(entry) ? "OVA" : entry.type?.alias === "ona" ? "ONA" : entry.type?.alias === "special" ? "Спешл" : "Серия", mapped = list.map(v => ({ ...v, originAnimeId: entry.anime_id, originNumber: v.number, contentKind: kind, contentTitle: entry.title, number: String((Number(v.number) || 1) + offset) })); offset += new Set(list.map(v => v.number)).size; return mapped ;}); const unique = [...new Map(normalized.map(v => [v.video_id, v])).values()]; return [group.number, unique] as const ;})); if (loadId !== videoLoadId.current) return; const next = mergeOfflineVideos(Object.fromEntries(loaded)); setSeasonVideos(next); setStatus(Object.values(next).some((list: Video[]) => list.length) ? "" : "Видео временно не загрузились"); } catch { if (loadId === videoLoadId.current) { setSeasonVideos(current => mergeOfflineVideos(current)); setStatus(Object.values(offlineVideosBySeason).some(list => list.length) ? "" : "Не удалось загрузить серии"); } } };
  useEffect(() => { void fetchVideos() ;}, [seasons.map(s => s.entries.map(e => e.anime_id).join(",")).join("|")]);
  const videos = seasonVideos[selectedSeason] ?? [];
  const selectedGroup = seasons.find(group => group.number === selectedSeason);
  useEffect(() => { if (!videos.length) return; const currentDubAvailable = videos.some(v => v.data.dubbing === dub), savedDubAvailable = saved?.dub && videos.some(v => v.data.dubbing === saved.dub), nextDub = currentDubAvailable ? dub : savedDubAvailable ? saved!.dub : videos[0].data.dubbing; setDub(nextDub); const nums = videos.filter(v => v.data.dubbing === nextDub).map(v => v.number).sort((a, b) => +a - +b), originMatch = resumeOriginAnimeId && resumeOriginEpisode ? videos.find(v => v.originAnimeId === resumeOriginAnimeId && v.originNumber === resumeOriginEpisode && v.data.dubbing === nextDub)?.number : undefined, nextEpisode = originMatch ?? (nums.includes(episode) ? episode : selectedSeason === resumeSeason && nums.includes(resumeEpisode) ? resumeEpisode : nums[0] ?? "1"); setEpisode(nextEpisode); setPlayer("") ;}, [selectedSeason, videos.length]);
  const dubs = Array.from(new Set(videos.map(v => v.data.dubbing))), episodes = Array.from(new Set(videos.filter(v => v.data.dubbing === dub).map(v => v.number))).sort((a, b) => +a - +b), sources = videos.filter(v => v.data.dubbing === dub && v.number === episode), onlineSources = sources.filter(v => !v.offline), preferredOffline = partyOnlineOnly ? undefined : sources.find(v => v.offline?.quality === downloadQuality), availableSources = partyOnlineOnly ? onlineSources : [...onlineSources, ...(preferredOffline ? [preferredOffline] : [])], players = Array.from(new Set(availableSources.map(v => v.data.player))), defaultSource = preferredOffline ?? onlineSources.find(v => /kodik/i.test(v.data.player)) ?? onlineSources[0], current = availableSources.find(v => v.data.player === player) ?? defaultSource, openingEnd = current?.skips?.opening ? current.skips.opening.time + current.skips.opening.length : 0, endingStart = current?.skips?.ending?.time ?? 0, endingEnd = current?.skips?.ending ? current.skips.ending.time + current.skips.ending.length : (current?.duration ?? 0);
  useEffect(() => {
    latestUiSelection.current = { season: selectedSeason, episode, dub, player: current?.data.player ?? player };
    if (!fullscreenActive.current && !isPlayerFullscreen()) {
      playbackCursor.current = latestUiSelection.current;
    }
  }, [selectedSeason, episode, dub, player, current?.data.player]);
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
  useEffect(() => { if (!availableSources.length) return; if (!availableSources.some(v => v.data.player === player)) setPlayer(defaultSource?.data.player ?? "") ;}, [dub, episode, availableSources.length, partyOnlineOnly, downloadQuality, defaultSource?.data.player]);
  const localPartyPlayback: PartyPlayback = { animeId: anime.anime_id, season: selectedSeason, episode, dub, player: current?.data.player ?? player, position: partyTime, duration: partyDuration || current?.duration || 0, playing: partyPlaying, updatedAt: Date.now() };
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
    const targetPlayer = targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub && video.data.player === host.player)?.data.player
      ?? targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub && /kodik/i.test(video.data.player))?.data.player
      ?? targetVideos.find(video => video.number === host.episode && video.data.dubbing === targetDub)?.data.player
      ?? player;
    const selectionChanged = host.season !== selectedSeason || host.episode !== episode || targetDub !== dub || targetPlayer !== (current?.data.player ?? player);
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
    if (!current?.iframe_url) return "";
    const synchronized = pendingPartyPlayback.current;
    const start = synchronized?.position ?? resumePositionFor(episodeKey);
    if (isKodikEmbed(current.iframe_url, current.data.player)) {
      return kodikSerialSource(current.iframe_url, String(current.originNumber ?? current.number), start);
    }
    if (start <= 5) return current.iframe_url;
    try {
      const normalized = current.iframe_url.startsWith("//") ? `https:${current.iframe_url}` : current.iframe_url;
      const url = new URL(normalized, "http://localhost");
      url.searchParams.set("start_from", String(Math.floor(start)));
      return url.toString();
    } catch {
      return current.iframe_url;
    }
  }, [current?.video_id, episodeKey]);
  useEffect(() => {
    if (!current?.iframe_url) {
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
  }, [iframeSource, current?.video_id]);
  const uniqueFranchiseVideos = Object.entries(seasonVideos).flatMap(([season, list]) => [...new Map(list.map(v => [`${season}:${v.number}`, v])).values()]), totalAcrossSeasons = uniqueFranchiseVideos.length, totalDurationAcrossSeasons = uniqueFranchiseVideos.reduce((sum, v) => sum + (v.duration ?? 0), 0), orderedEpisodeKeys = seasons.flatMap(group => Array.from(new Set((seasonVideos[group.number] ?? []).filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => video.number))).sort((a, b) => +a - +b).map(number => `${group.number}:${number}`)), pendingDisplayKeys = (tracker?.pendingEpisodeKeys ?? []).flatMap(rawKey => { for (const [season, list] of Object.entries(seasonVideos)) { const match = list.find(video => `${video.originAnimeId}:${video.originNumber}` === rawKey && (!tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing))); if (match) return [`${season}:${match.number}`] ;} return [] ;}), datedEpisodeKeys = [...new Map(Object.entries(seasonVideos).flatMap(([season, list]) => list.filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => [`${video.originAnimeId}:${video.originNumber}`, { displayKey: `${season}:${video.number}`, date: video.date ?? 0 }] as const))).values()].sort((a, b) => a.date - b.date).map(item => item.displayKey), resolvedNewEpisodeKeys = pendingDisplayKeys.length ? pendingDisplayKeys : (tracker?.newEpisodes ? datedEpisodeKeys.slice(-tracker.newEpisodes) : []), newEpisodeKeys = new Set(resolvedNewEpisodeKeys);
  useEffect(() => { if (!newEpisodeRequested || newEpisodeOpened.current || !tracker?.newEpisodes || !resolvedNewEpisodeKeys.length) return; const target = resolvedNewEpisodeKeys[0], separator = target.indexOf(":"), targetSeason = Number(target.slice(0, separator)), targetEpisode = target.slice(separator + 1); if (selectedSeason !== targetSeason) { setSelectedSeason(targetSeason); return ;} const targetVideos = (seasonVideos[targetSeason] ?? []).filter(video => video.number === targetEpisode), preferredDub = (tracker.dubs ?? []).find(name => targetVideos.some(video => video.data.dubbing === name)) ?? targetVideos[0]?.data.dubbing; if (!preferredDub) return; const targetSources = targetVideos.filter(video => video.data.dubbing === preferredDub), preferredPlayer = targetSources.find(video => /kodik/i.test(video.data.player))?.data.player ?? targetSources[0]?.data.player ?? ""; newEpisodeOpened.current = true; setDub(preferredDub); setEpisode(targetEpisode); setPlayer(preferredPlayer); setAutoPlay(true) ;}, [newEpisodeRequested, tracker?.newEpisodes, tracker?.dubs?.join("|"), resolvedNewEpisodeKeys.join("|"), selectedSeason, seasonVideos]);
  const scheduleRows: ReleaseScheduleRow[] = seasons
    .flatMap(group => group.entries.map(entry => ({ group, entry, item: schedule[entry.anime_id] })))
    .filter((row): row is ReleaseScheduleRow => Boolean(row.item?.episodes?.next_date))
    .sort((a, b) => (a.item.episodes?.next_date ?? 0) - (b.item.episodes?.next_date ?? 0));
  const carouselItems = seasons.flatMap(group => { const list = seasonVideos[group.number] ?? [], numbers = Array.from(new Set(list.map(video => video.number))).sort((a, b) => +a - +b); return numbers.map(number => { const candidates = list.filter(video => video.number === number), video = candidates.find(item => item.data.dubbing === dub) ?? candidates[0], entry = group.entries.find(item => item.anime_id === video?.originAnimeId) ?? group.entries[0]; return { season: group.number, number, group, video, entry } ;}) ;}), carouselIndex = carouselItems.findIndex(item => item.season === selectedSeason && item.number === episode), previousCarouselItem = showUpcoming ? (carouselIndex >= 0 ? carouselItems[carouselIndex] : undefined) : (carouselIndex > 0 ? carouselItems[carouselIndex - 1] : undefined), nextCarouselItem = !showUpcoming && carouselIndex >= 0 ? carouselItems[carouselIndex + 1] : undefined, upcomingRow = !nextCarouselItem ? scheduleRows.find(row => (row.item?.episodes?.next_date ?? 0) * 1000 > Date.now() - 86400000) : undefined, upcomingEpisode = upcomingRow ? Math.max(1, (upcomingRow.item?.episodes?.aired ?? (Number(episode) || 0)) + 1) : 0, upcomingTotal = upcomingRow?.item?.episodes?.count ?? 0, upcomingSeason = upcomingRow?.group.number ?? selectedSeason;
  const activePlaybackContext = () => {
    const selection = (fullscreenActive.current || isPlayerFullscreen())
      ? playbackCursor.current
      : { season: selectedSeason, episode, dub, player: current?.data.player ?? player };
    const list = seasonVideos[selection.season] ?? [];
    const video = list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub && item.data.player === selection.player)
      ?? list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub && /kodik/i.test(item.data.player))
      ?? list.find(item => item.number === selection.episode && item.data.dubbing === selection.dub)
      ?? list.find(item => item.number === selection.episode)
      ?? current;
    const group = seasons.find(item => item.number === selection.season) ?? selectedGroup;
    const activeOpeningEnd = video?.skips?.opening ? video.skips.opening.time + video.skips.opening.length : 0;
    const activeEndingStart = video?.skips?.ending?.time ?? 0;
    const activeEndingEnd = video?.skips?.ending ? video.skips.ending.time + video.skips.ending.length : (video?.duration ?? 0);
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
    onProgress(entry.value, entry.originEpisodeKey);
  };
  const save = (time: number, duration: number, completed = false) => {
    const playback = activePlaybackContext();
    const snapshot = savedRef.current, previous = snapshot?.episodes[playback.key], percent = duration ? Math.min(100, Math.round(time / duration * 100)) : previous?.percent ?? 0, reachedEnd = completed || percent >= 100 || (playback.endingStart > 0 && time >= playback.endingStart), startedAgain = Boolean(previous?.completed && time < 60 && time < (previous.position ?? 0)), rewatchArmed = startedAgain || previous?.rewatchArmed === true, firstCompletion = reachedEnd && !previous?.completed, repeatCompletion = reachedEnd && rewatchArmed, delta = previous && time >= previous.position && time - previous.position <= 90 ? time - previous.position : 0, originEpisodeKey = playback.video?.originAnimeId && playback.video.originNumber ? `${playback.video.originAnimeId}:${playback.video.originNumber}` : undefined;
    const completedNow = firstCompletion || repeatCompletion, updatedAt = Date.now();
    const value: AnimeProgress = { episode: playback.episode, dub: playback.dub || dub, season: playback.season, seasonLabel: playback.group?.label, originAnimeId: playback.video?.originAnimeId, originEpisode: playback.video?.originNumber, totalEpisodes: totalAcrossSeasons || episodes.length, totalDuration: totalDurationAcrossSeasons || snapshot?.totalDuration, episodes: { ...(snapshot?.episodes ?? {}), [playback.key]: { position: time, duration, percent, originAnimeId: playback.video?.originAnimeId ?? previous?.originAnimeId, originEpisode: playback.video?.originNumber ?? previous?.originEpisode, completed: previous?.completed || reachedEnd, completions: (previous?.completions ?? (previous?.completed ? 1 : 0)) + (completedNow ? 1 : 0), completionHistory: completedNow ? [...(previous?.completionHistory ?? []), updatedAt] : previous?.completionHistory, rewatchArmed: repeatCompletion ? false : rewatchArmed, watchedSeconds: (previous?.watchedSeconds ?? Math.min(previous?.position ?? 0, previous?.duration || previous?.position || 0)) + Math.max(0, delta), updatedAt } } };
    savedRef.current = value;
    const entry = { value, originEpisodeKey: reachedEnd ? originEpisodeKey : undefined };
    pendingProgress.current = entry;
    const elapsed = Date.now() - lastProgressCommit.current;
    if (completed || reachedEnd || elapsed >= 5000) commitProgress(entry);
    else if (!progressTimer.current) progressTimer.current = setTimeout(() => { if (pendingProgress.current) commitProgress(pendingProgress.current) ;}, 5000 - elapsed);
  };
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
  useEffect(() => () => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
  }, []);
  useEffect(() => {
    const flush = () => {
      if (pendingProgress.current) commitProgress(pendingProgress.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  const chooseEpisode = (nextEpisode: string, nextSeason = selectedSeason, scrollToPlayer = true) => { cancelPendingPlayerEpisodeSwitch(); playerManagedEpisodeSwitch.current = false; setShowUpcoming(false); setSelectedSeason(nextSeason); setEpisode(nextEpisode); setPlayer(""); if (scrollToPlayer && autoScrollPlayer) requestAnimationFrame(() => requestAnimationFrame(() => playerShell.current?.scrollIntoView({ behavior: "smooth", block: "start" }))) ;};
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
    if (!sameOrigin || next.season !== selectedSeason || !/kodik/i.test(current?.data.player ?? player)) return false;

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
      : { season: selectedSeason, episode, dub, player: current?.data.player ?? player };
    const activeIndex = carouselItems.findIndex(item => item.season === activeSelection.season && item.number === activeSelection.episode);
    const next = activeIndex >= 0 ? carouselItems[activeIndex + 1] : undefined;
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
  const localTimeUpdated = () => {
    const video = localVideo.current;
    if (!video || !current?.offline) return;
    const time = video.currentTime;
    const duration = Number.isFinite(video.duration) ? video.duration : (current.duration ?? 0);
    if (initialPrefs.watchPartyEnabled) {
      setPartyTime(time);
      setPartyDuration(duration);
      setPartyPlaying(!video.paused);
    }
    const restoring = restoreSavedPosition(time);
    if (!restoring) save(time, duration);
    if (autoSkip && openingEnd > 0 && time < openingEnd) command("seek", { seconds: openingEnd });
    if (autoSkipEnding && endingStart > 0 && time >= endingStart && time < endingEnd) {
      save(endingStart, duration, true);
      if (autoNext) advanceAfterPlayback();
      else command("seek", { seconds: endingEnd });
    }
  };
  const localEnded = () => {
    const duration = localVideo.current?.duration || current?.duration || 0;
    save(duration, duration, true);
    setPartyPlaying(false);
    if (autoNext) advanceAfterPlayback();
  };
  const requestDownload = async (scope: "episode" | "season" | "anime") => {
    if (isSubmittingDownload || downloadJob?.status === "queued" || downloadJob?.status === "downloading") return;
    const sourceLists = scope === "episode"
      ? [[selectedSeason, sources] as const]
      : scope === "season"
        ? [[selectedSeason, seasonVideos[selectedSeason] ?? []] as const]
        : Object.entries(seasonVideos).map(([season, list]) => [Number(season), list] as const);
    const selected = new Map<string, Video & { __season: number }>();
    for (const [season, list] of sourceLists) {
      for (const video of list) {
        if (video.offline || video.data.dubbing !== dub || !isKodikEmbed(video.iframe_url, video.data.player)) continue;
        const key = `${season}:${video.number}:${video.data.dubbing}`;
        const currentChoice = selected.get(key);
        if (!currentChoice || /kodik/i.test(video.data.player)) selected.set(key, { ...video, __season: season });
      }
    }
    const episodes = [...selected.values()].map(video => {
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
        episode: video.number,
        originAnimeId: video.originAnimeId,
        originEpisode: video.originNumber,
        dubbing: video.data.dubbing,
        // `player_id` is YummyAnime's provider id (Kodik is commonly `4`),
        // not Kodik's translation id. Supplying it as a translation makes the
        // API look for an unrelated/nonexistent dub. If Yummy has no explicit
        // Kodik translation id, the resolver uses the embed's default voice.
        translationId: video.data.translation_id,
        // The player itself opens Kodik through the serial URL: it removes
        // `only_episode` / `only_season` and supplies the chosen episode.
        // Passing the raw one-episode embed to the downloader gives Kodik a
        // different document without its signed `urlParams`, so a playing
        // episode could still fail immediately when being saved offline.
        iframeUrl: kodikSerialSource(video.iframe_url, String(video.originNumber ?? video.number)),
        ...sourceReference,
        duration: video.duration,
        previewUrl: episodePreviewImages(previewAnime, video.originNumber ?? video.number)[0],
      };
    });
    if (!episodes.length) {
      setDownloadNotice("Для выбранной озвучки пока нет доступных онлайн-серий Kodik.");
      return;
    }
    try {
      setIsSubmittingDownload(true);
      setDownloadNotice("Добавляем выбранные серии в очередь…");
      const job = await enqueueDownload({
        animeId: anime.anime_id,
        title: anime.title,
        year: anime.year,
        posterUrl: anime.poster?.fullsize ?? anime.poster?.big,
        quality: downloadQuality,
        episodes,
      });
      setDownloadJob(job);
      setDownloadNotice("");
    } catch (error) {
      setDownloadJob(null);
      setDownloadNotice(error instanceof Error ? error.message : "Не удалось добавить загрузку в очередь.");
    } finally {
      setIsSubmittingDownload(false);
    }
  };
  const downloadIsActive = isSubmittingDownload || downloadJob?.status === "queued" || downloadJob?.status === "downloading";
  const visibleDownloadNotice = downloadJob ? downloadJobText(downloadJob) : downloadNotice;
  const setToolbar = (p: ToolbarPosition) => { setPosition(p); write(K.toolbar, p) ;};
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
      <section className="watch-rating-panel" aria-label="Оценки аниме">
        <div><span className="eyebrow">ОЦЕНКИ</span><RatingBoard anime={anime} ratings={ratings} communityRating={communityRating} /></div>
        <ScorePicker
          value={ratings?.anime}
          label="Ваша оценка аниме"
          onChange={value => onRatingChange({ scope: "anime" }, value)}
        />
      </section>
      <div className="season-tabs">{seasons.map(s => <button className={`${s.number === selectedSeason ? "active " : ""}${s.kind === "special" ? "extra" : ""}`.trim()} key={s.number} onClick={() => { cancelPendingPlayerEpisodeSwitch(); playerManagedEpisodeSwitch.current = false; setShowUpcoming(false); setSelectedSeason(s.number) ;}}>{s.label ?? `Сезон ${s.number}`}</button>)}</div>
      <div ref={playerShell} className={`episode-carousel ${episodeCarousel ? "enabled" : "disabled"} ${carouselMotion ? `shift-${carouselMotion}` : ""}`}>{episodeCarousel && previousCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-previous" images={episodePreviewImages(previousCarouselItem.entry, previousCarouselItem.video?.originNumber ?? previousCarouselItem.number)} fallback={previousCarouselItem.entry?.poster?.fullsize ?? previousCarouselItem.entry?.poster?.big} label={previousCarouselItem.group.label ?? `Сезон ${previousCarouselItem.season}`} sublabel={`${previousCarouselItem.video?.contentKind ?? "Серия"} ${previousCarouselItem.number}`} onClick={() => activateCarouselItem(previousCarouselItem, "previous")} /> : episodeCarousel ? <span className="carousel-space" /> : null}
      {initialPrefs.watchPartyPanelPosition === "top" && partyPanel}
      <div className={`video-layout ${showUpcoming ? "upcoming-layout" : `toolbar-${position}`}`}>
      <div ref={playerFrame} className={`player-frame ${showUpcoming ? "upcoming-frame" : ""}`}>{showUpcoming && upcomingRow ? <div className="upcoming-player"><span>СЛЕДУЮЩАЯ СЕРИЯ</span><b>{upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия {upcomingEpisode}{upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}</b><time>{formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}</time><small>{upcomingRow.item?.episodes?.aired ?? 0} серий уже вышло · следующая ещё недоступна</small></div> : <>{current?.offline ? <video ref={localVideo} className="offline-player-video" src={current.offline.mediaUrl} controls playsInline onLoadedMetadata={loaded} onTimeUpdate={localTimeUpdated} onPlay={() => setPartyPlaying(true)} onPause={() => setPartyPlaying(false)} onEnded={localEnded} /> : (current || renderedIframeSource) && <iframe ref={iframe} src={renderedIframeSource || iframeSource} onLoad={loaded} title={`${base}, ${selectedGroup?.label ?? `серия ${episode}`}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}{current && !current.offline && isKodikEmbed(current.iframe_url, current.data.player) && <button type="button" tabIndex={-1} aria-label="Полный экран" className="fullscreen-bridge" onClick={toggleStableFullscreen} />}{status && <div className="player-status"><span>{status}</span>{!current && !status.includes("Загружаем") && <button onClick={() => void fetchVideos()}>Повторить загрузку</button>}</div>}</>}</div>
      {!showUpcoming && (
        <PlayerToolbar
          dubbings={dubs}
          dubbing={dub}
          onDubbingChange={value => {
            setDub(value);
            chooseEpisode(videos.find(video => video.data.dubbing === value)?.number ?? "1");
          }}
          episodes={episodes.map(value => {
            const duration = episodeDuration(videos, value);
            const watched = isEpisodeWatched(saved?.episodes[`${selectedSeason}:${value}`]);
            return {
              value,
              label: `${value}${duration ? ` · ${formatDuration(duration)}` : ""}${watched ? " · Просмотрено" : ""}`,
            };
          })}
          episode={episode}
          onEpisodeChange={chooseEpisode}
          sources={players}
          source={current?.data.player ?? player}
          onSourceChange={value => {
            playerManagedEpisodeSwitch.current = false;
            setPlayer(value);
          }}
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
          downloadControls={(
            <div className={`offline-download-controls${downloadIsActive ? " is-active" : ""}`}>
              <details className="offline-download-menu">
                <summary title={downloadJob ? downloadJobText(downloadJob) : "Скачать"} aria-label={downloadJob ? downloadJobText(downloadJob) : "Скачать"}><span>⇩ Скачать</span></summary>
                <div className="offline-download-menu-content">
                  <label>
                    Качество
                    <select
                      value={downloadQuality}
                      onChange={event => {
                        const next = Number(event.target.value);
                        setDownloadQuality(next);
                        write("animesoul:download-quality", next);
                      }}
                    >
                      {[360, 480, 720, 1080].map(value => <option key={value} value={value}>{value}p</option>)}
                    </select>
                  </label>
                  {downloadJob && (
                    <div className={`offline-download-status is-${downloadJob.status}`} role="status" aria-live="polite">
                      <div>
                        <strong>{downloadJobLabel(downloadJob.status)}</strong>
                        <span>{downloadJob.current || `${downloadJob.completed} из ${downloadJob.total} сер.`}</span>
                      </div>
                      <div className="offline-download-status-progress" role="progressbar" aria-label={downloadJobText(downloadJob)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downloadJob.progress * 100)}>
                        <span style={{ width: `${Math.round(Math.max(0, Math.min(1, downloadJob.progress)) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  <button type="button" disabled={downloadIsActive} onClick={() => void requestDownload("episode")}>Эту серию</button>
                  <button type="button" disabled={downloadIsActive} onClick={() => void requestDownload("season")}>Весь сезон</button>
                  <button type="button" disabled={downloadIsActive} onClick={() => void requestDownload("anime")}>Всё аниме</button>
                </div>
              </details>
              {visibleDownloadNotice && (
                <div className={`offline-download-notice${downloadJob ? ` is-${downloadJob.status}` : " is-error"}`} role="status" aria-live="polite">
                  <strong>{downloadJob ? downloadJobLabel(downloadJob.status) : "Загрузка"}</strong>
                  <span>{visibleDownloadNotice}</span>
                </div>
              )}
            </div>
          )}
        />
      )}</div>
      {initialPrefs.watchPartyPanelPosition === "overlay" && partyPanel}
      {episodeCarousel && (nextCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-next" images={episodePreviewImages(nextCarouselItem.entry, nextCarouselItem.video?.originNumber ?? nextCarouselItem.number)} fallback={nextCarouselItem.entry?.poster?.fullsize ?? nextCarouselItem.entry?.poster?.big} label={nextCarouselItem.group.label ?? `Сезон ${nextCarouselItem.season}`} sublabel={`${nextCarouselItem.video?.contentKind ?? "Серия"} ${nextCarouselItem.number}`} onClick={() => activateCarouselItem(nextCarouselItem, "next")} /> : upcomingRow && !showUpcoming ? <EpisodeSlideshow className="carousel-side carousel-next upcoming-preview" images={episodePreviewImages(upcomingRow.entry)} fallback={upcomingRow.entry.poster?.fullsize ?? upcomingRow.entry.poster?.big} label={`${upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия ${upcomingEpisode}${upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}`} sublabel={`Выйдет ${formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}`} onClick={() => { setCarouselMotion("next"); setShowUpcoming(true); setTimeout(() => setCarouselMotion(""), 520) ;}} /> : <span className="carousel-space" />)}</div>
      {initialPrefs.watchPartyPanelPosition === "bottom" && partyPanel}
      <WatchInfo
        anime={anime}
        seasons={seasons}
        seasonVideos={seasonVideos}
        dubs={dubs}
        activeDub={dub}
        familyTitle={familyRoot}
        favorite={favorite}
        tracker={tracker}
        totalEpisodes={totalAcrossSeasons}
        totalDuration={totalDurationAcrossSeasons}
        onGenre={onGenre}
        onFavorite={onFavorite}
        onFolders={onFolders}
        onTrack={onTrack}
        onUntrack={onUntrack}
        onResetProgress={onProgress}
      />
      <ReleaseSchedule rows={scheduleRows} />
      <SeasonList
        seasons={seasons}
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
        newEpisodeKeys={newEpisodeKeys}
        onToggleSeason={toggleSeason}
        onToggleSeasonWatched={toggleSeasonWatched}
        onChooseEpisode={chooseEpisode}
        onToggleWatched={toggleWatched}
        onSeasonRatingChange={(season, value) => onRatingChange({ scope: "season", season }, value)}
        onEpisodeRatingChange={(season, ratedEpisode, value) => onRatingChange({ scope: "episode", season, episode: ratedEpisode }, value)}
      />
    </section>{folderPicker && <FolderPicker anime={folderPicker} folders={folders} onToggle={toggleFolder} onCreate={createFolder} onClose={closePicker} />}</main>;
}
