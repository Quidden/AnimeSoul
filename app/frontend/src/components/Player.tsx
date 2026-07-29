"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Anime, AnimeProgress, Folder, PartyPlayback, PlayerPrefs, ScheduleEntry, SeasonGroup, ToolbarPosition, Tracker, Video } from "../lib/types";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K } from "../lib/settings";
import { readLocal as read, writeLocal as write } from "../lib/storage";
import { byViewingOrder, durationRange, episodeDuration, episodeResumePosition, fetchFamily, formatCalendarDate, formatDuration, formatTime, franchiseName, isEpisodeWatched, isExtraAnime, isMovieAnime, isOvaAnime, latestResumePoint, releaseStatus, shortEntryTitle, stripPart, toggleEpisodeWatched } from "../lib/anime";
import { EpisodeSlideshow, episodePreviewImages } from "./EpisodeSlideshow";
import { EpisodeHoverPreview } from "./EpisodeHoverPreview";
import { FolderPicker } from "./FolderPicker";
import { Toggle } from "./Toggle";
import { useWatchParty } from "../hooks/useWatchParty";

export function Watch({ header, anime, resumeRequested, newEpisodeRequested, favorite, onFavorite, onBack, onLibrary, onGenre, saved, onProgress, onPlayerPrefsChange, onFolders, tracker, onTrack, onUntrack, folderPicker, folders, toggleFolder, createFolder, closePicker }: { header: ReactNode; anime: Anime; resumeRequested: boolean; newEpisodeRequested: boolean; favorite: boolean; onFavorite: () => void; onBack: () => void; onLibrary: () => void; onGenre: (genre: string) => void; saved?: AnimeProgress; onProgress: (v: AnimeProgress, originEpisodeKey?: string | string[], changedEpisodeKey?: string | string[]) => void; onPlayerPrefsChange: (prefs: PlayerPrefs) => void; onFolders: () => void; tracker?: Tracker; onTrack: (n: number, d: string[], ids: number[], title: string, knownKeys: string[]) => void; onUntrack: () => void; folderPicker: Anime | null; folders: Folder[]; toggleFolder: (f: Folder, id: number) => void; createFolder: () => unknown; closePicker: () => void ;}) {
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
  const [dub, setDub] = useState(saved?.dub ?? ""), [episode, setEpisode] = useState(resumeEpisode), [player, setPlayer] = useState(""), [autoNext, setAutoNextState] = useState(initialPrefs.autoNext), [autoSkip, setAutoSkipState] = useState(initialPrefs.autoSkipOpening), [autoSkipEnding, setAutoSkipEndingState] = useState(initialPrefs.autoSkipEnding), [autoPlayResume, setAutoPlayResumeState] = useState(initialPrefs.autoPlayResume), [autoScrollPlayer, setAutoScrollPlayerState] = useState(initialPrefs.autoScrollPlayer), [episodeCarousel, setEpisodeCarousel] = useState(initialPrefs.playerEpisodeCarousel), [status, setStatus] = useState("Загружаем серии…"), [position, setPosition] = useState<ToolbarPosition>(read(K.toolbar, "bottom")), [autoPlay, setAutoPlay] = useState(false), [seasons, setSeasons] = useState<SeasonGroup[]>([{ number: 1, entries: [anime] }]), [selectedSeason, setSelectedSeason] = useState(resumeSeason), [seasonVideos, setSeasonVideos] = useState<Record<number, Video[]>>({}), [schedule, setSchedule] = useState<Record<number, ScheduleEntry>>({}), [trackOpen, setTrackOpen] = useState(false), [trackDubs, setTrackDubs] = useState<string[]>(tracker?.dubs ?? []), [showUpcoming, setShowUpcoming] = useState(false), [carouselMotion, setCarouselMotion] = useState<"" | "previous" | "next">("");
  const [episodeHoverPreview, setEpisodeHoverPreview] = useState(initialPrefs.episodeHoverPreview);
  const [partyRoomCode, setPartyRoomCode] = useState(""), [partyTime, setPartyTime] = useState(0), [partyDuration, setPartyDuration] = useState(0), [partyPlaying, setPartyPlaying] = useState(false);
  const [suggestedHostDub, setSuggestedHostDub] = useState<string | null>(null), [partyDubNotice, setPartyDubNotice] = useState("");
  const [previewAnimeById, setPreviewAnimeById] = useState<Record<number, Anime>>({});
  const collapsedSeasonsKey = `animesoul:collapsed-seasons:${anime.anime_id}`;
  const [collapsedSeasons, setCollapsedSeasons] = useState<number[]>(read(collapsedSeasonsKey, []));
  const iframe = useRef<HTMLIFrameElement>(null), playerShell = useRef<HTMLDivElement>(null), newEpisodeOpened = useRef(false), videoLoadId = useRef(0), lastPartyTime = useRef(0), lastPartyMotionAt = useRef(0), partyPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null), lastHostPlaying = useRef<boolean | null>(null), pendingPartyPlayback = useRef<PartyPlayback | null>(null), dismissedHostDub = useRef<string | null>(null), latestHostPlayback = useRef<PartyPlayback | null>(null);
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
  const command = (method: string, extra = {}) => iframe.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method, ...extra } }, "*");
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
    const closeOutside = (event: PointerEvent) => {
      const options = document.querySelector<HTMLDetailsElement>(".player-options");
      if (options?.open && event.target instanceof Node && !options.contains(event.target)) {
        options.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  useEffect(() => {
    const prefsChanged = (event: Event) => {
      const prefs = (event as CustomEvent<PlayerPrefs>).detail;
      setAutoNextState(prefs.autoNext);
      setAutoSkipState(prefs.autoSkipOpening);
      setAutoSkipEndingState(prefs.autoSkipEnding);
      setAutoPlayResumeState(prefs.autoPlayResume);
      setAutoScrollPlayerState(prefs.autoScrollPlayer);
      setEpisodeCarousel(prefs.playerEpisodeCarousel);
      setEpisodeHoverPreview(prefs.episodeHoverPreview);
    };
    const toolbarChanged = (event: Event) => setPosition((event as CustomEvent<ToolbarPosition>).detail);
    window.addEventListener("animesoul:player-prefs", prefsChanged);
    window.addEventListener("animesoul:toolbar", toolbarChanged);
    return () => {
      window.removeEventListener("animesoul:player-prefs", prefsChanged);
      window.removeEventListener("animesoul:toolbar", toolbarChanged);
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
  const fetchVideos = async () => { const loadId = ++videoLoadId.current; setStatus("Загружаем сезоны…"); try { const loaded = await Promise.all(seasons.map(async group => { const ordered = [...group.entries].sort(byViewingOrder), payloads = await Promise.all(ordered.map(async entry => { for (let attempt = 0; attempt < 4; attempt++) { const r = await fetch(`/api/yummy?mode=videos&id=${entry.anime_id}`), p = await r.json(); if (r.ok) return { entry, list: p.videos as Video[] }; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1))) ;} return { entry, list: [] as Video[] } ;})); let offset = 0; const normalized = payloads.flatMap(({ entry, list }) => { const kind: Video["contentKind"] = group.kind === "movie" ? "Фильм" : isOvaAnime(entry) ? "OVA" : entry.type?.alias === "ona" ? "ONA" : entry.type?.alias === "special" ? "Спешл" : "Серия", mapped = list.map(v => ({ ...v, originAnimeId: entry.anime_id, originNumber: v.number, contentKind: kind, contentTitle: entry.title, number: String((Number(v.number) || 1) + offset) })); offset += new Set(list.map(v => v.number)).size; return mapped ;}); const unique = [...new Map(normalized.map(v => [v.video_id, v])).values()]; return [group.number, unique] as const ;})); if (loadId !== videoLoadId.current) return; const next = Object.fromEntries(loaded); setSeasonVideos(next); setStatus(Object.values(next).some((list: Video[]) => list.length) ? "" : "Видео временно не загрузились"); } catch { if (loadId === videoLoadId.current) setStatus("Не удалось загрузить серии") ;} };
  useEffect(() => { void fetchVideos() ;}, [seasons.map(s => s.entries.map(e => e.anime_id).join(",")).join("|")]);
  const videos = seasonVideos[selectedSeason] ?? [];
  const selectedGroup = seasons.find(group => group.number === selectedSeason);
  useEffect(() => { if (!videos.length) return; const currentDubAvailable = videos.some(v => v.data.dubbing === dub), savedDubAvailable = saved?.dub && videos.some(v => v.data.dubbing === saved.dub), nextDub = currentDubAvailable ? dub : savedDubAvailable ? saved!.dub : videos[0].data.dubbing; setDub(nextDub); const nums = videos.filter(v => v.data.dubbing === nextDub).map(v => v.number).sort((a, b) => +a - +b), originMatch = resumeOriginAnimeId && resumeOriginEpisode ? videos.find(v => v.originAnimeId === resumeOriginAnimeId && v.originNumber === resumeOriginEpisode && v.data.dubbing === nextDub)?.number : undefined, nextEpisode = originMatch ?? (nums.includes(episode) ? episode : selectedSeason === resumeSeason && nums.includes(resumeEpisode) ? resumeEpisode : nums[0] ?? "1"); setEpisode(nextEpisode); setPlayer("") ;}, [selectedSeason, videos.length]);
  const dubs = Array.from(new Set(videos.map(v => v.data.dubbing))), episodes = Array.from(new Set(videos.filter(v => v.data.dubbing === dub).map(v => v.number))).sort((a, b) => +a - +b), sources = videos.filter(v => v.data.dubbing === dub && v.number === episode), players = Array.from(new Set(sources.map(v => v.data.player))), current = sources.find(v => v.data.player === player) ?? sources.find(v => /kodik/i.test(v.data.player)) ?? sources[0], openingEnd = current?.skips?.opening ? current.skips.opening.time + current.skips.opening.length : 0, endingStart = current?.skips?.ending?.time ?? 0, endingEnd = current?.skips?.ending ? current.skips.ending.time + current.skips.ending.length : (current?.duration ?? 0);
  useEffect(() => { if (!sources.length) return; const preferred = sources.find(v => /kodik/i.test(v.data.player))?.data.player ?? sources[0].data.player; if (!sources.some(v => v.data.player === player)) setPlayer(preferred) ;}, [dub, episode, sources.length]);
  const localPartyPlayback: PartyPlayback = { animeId: anime.anime_id, season: selectedSeason, episode, dub, player: current?.data.player ?? player, position: partyTime, duration: partyDuration || current?.duration || 0, playing: partyPlaying, updatedAt: Date.now() };
  const applyHostState = (host: PartyPlayback, force = false) => {
    if (host.animeId !== anime.anime_id) return;
    latestHostPlayback.current = host;
    const targetVideos = seasonVideos[host.season] ?? [];
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
  const party = useWatchParty({ enabled: initialPrefs.watchPartyEnabled, server: initialPrefs.watchPartyServer, name: initialPrefs.watchPartyName, mode: initialPrefs.watchPartyMode, roomMode: initialPrefs.watchPartyRoomMode, playback: localPartyPlayback, onHostState: applyHostState });
  const acceptHostDub = () => {
    const host = latestHostPlayback.current;
    if (!host) return;
    dismissedHostDub.current = null;
    setSuggestedHostDub(null);
    const targetVideos = seasonVideos[host.season] ?? [];
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
    if (start <= 5 || !/kodik/i.test(current.data.player)) return current.iframe_url;
    try {
      const normalized = current.iframe_url.startsWith("//") ? `https:${current.iframe_url}` : current.iframe_url;
      const url = new URL(normalized, "http://localhost");
      url.searchParams.set("start_from", String(Math.floor(start)));
      return url.toString();
    } catch {
      return current.iframe_url;
    }
  }, [current?.video_id, episodeKey]);
  const uniqueFranchiseVideos = Object.entries(seasonVideos).flatMap(([season, list]) => [...new Map(list.map(v => [`${season}:${v.number}`, v])).values()]), totalAcrossSeasons = uniqueFranchiseVideos.length, totalDurationAcrossSeasons = uniqueFranchiseVideos.reduce((sum, v) => sum + (v.duration ?? 0), 0), orderedEpisodeKeys = seasons.flatMap(group => Array.from(new Set((seasonVideos[group.number] ?? []).filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => video.number))).sort((a, b) => +a - +b).map(number => `${group.number}:${number}`)), pendingDisplayKeys = (tracker?.pendingEpisodeKeys ?? []).flatMap(rawKey => { for (const [season, list] of Object.entries(seasonVideos)) { const match = list.find(video => `${video.originAnimeId}:${video.originNumber}` === rawKey && (!tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing))); if (match) return [`${season}:${match.number}`] ;} return [] ;}), datedEpisodeKeys = [...new Map(Object.entries(seasonVideos).flatMap(([season, list]) => list.filter(video => !tracker?.dubs?.length || tracker.dubs.includes(video.data.dubbing)).map(video => [`${video.originAnimeId}:${video.originNumber}`, { displayKey: `${season}:${video.number}`, date: video.date ?? 0 }] as const))).values()].sort((a, b) => a.date - b.date).map(item => item.displayKey), resolvedNewEpisodeKeys = pendingDisplayKeys.length ? pendingDisplayKeys : (tracker?.newEpisodes ? datedEpisodeKeys.slice(-tracker.newEpisodes) : []), newEpisodeKeys = new Set(resolvedNewEpisodeKeys);
  useEffect(() => { if (!newEpisodeRequested || newEpisodeOpened.current || !tracker?.newEpisodes || !resolvedNewEpisodeKeys.length) return; const target = resolvedNewEpisodeKeys[0], separator = target.indexOf(":"), targetSeason = Number(target.slice(0, separator)), targetEpisode = target.slice(separator + 1); if (selectedSeason !== targetSeason) { setSelectedSeason(targetSeason); return ;} const targetVideos = (seasonVideos[targetSeason] ?? []).filter(video => video.number === targetEpisode), preferredDub = (tracker.dubs ?? []).find(name => targetVideos.some(video => video.data.dubbing === name)) ?? targetVideos[0]?.data.dubbing; if (!preferredDub) return; const targetSources = targetVideos.filter(video => video.data.dubbing === preferredDub), preferredPlayer = targetSources.find(video => /kodik/i.test(video.data.player))?.data.player ?? targetSources[0]?.data.player ?? ""; newEpisodeOpened.current = true; setDub(preferredDub); setEpisode(targetEpisode); setPlayer(preferredPlayer); setAutoPlay(true) ;}, [newEpisodeRequested, tracker?.newEpisodes, tracker?.dubs?.join("|"), resolvedNewEpisodeKeys.join("|"), selectedSeason, seasonVideos]);
  const scheduleRows = seasons.flatMap(group => group.entries.map(entry => ({ group, entry, item: schedule[entry.anime_id] }))).filter(row => row.item?.episodes?.next_date).sort((a, b) => (a.item.episodes?.next_date ?? 0) - (b.item.episodes?.next_date ?? 0));
  const carouselItems = seasons.flatMap(group => { const list = seasonVideos[group.number] ?? [], numbers = Array.from(new Set(list.map(video => video.number))).sort((a, b) => +a - +b); return numbers.map(number => { const candidates = list.filter(video => video.number === number), video = candidates.find(item => item.data.dubbing === dub) ?? candidates[0], entry = group.entries.find(item => item.anime_id === video?.originAnimeId) ?? group.entries[0]; return { season: group.number, number, group, video, entry } ;}) ;}), carouselIndex = carouselItems.findIndex(item => item.season === selectedSeason && item.number === episode), previousCarouselItem = showUpcoming ? (carouselIndex >= 0 ? carouselItems[carouselIndex] : undefined) : (carouselIndex > 0 ? carouselItems[carouselIndex - 1] : undefined), nextCarouselItem = !showUpcoming && carouselIndex >= 0 ? carouselItems[carouselIndex + 1] : undefined, upcomingRow = !nextCarouselItem ? scheduleRows.find(row => (row.item?.episodes?.next_date ?? 0) * 1000 > Date.now() - 86400000) : undefined, upcomingEpisode = upcomingRow ? Math.max(1, (upcomingRow.item?.episodes?.aired ?? (Number(episode) || 0)) + 1) : 0, upcomingTotal = upcomingRow?.item?.episodes?.count ?? 0, upcomingSeason = upcomingRow?.group.number ?? selectedSeason;
  const commitProgress = (entry: { value: AnimeProgress; originEpisodeKey?: string }) => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = null;
    pendingProgress.current = null;
    lastProgressCommit.current = Date.now();
    onProgress(entry.value, entry.originEpisodeKey);
  };
  const save = (time: number, duration: number, completed = false) => {
    const snapshot = savedRef.current, previous = snapshot?.episodes[episodeKey], percent = duration ? Math.min(100, Math.round(time / duration * 100)) : previous?.percent ?? 0, reachedEnd = completed || percent >= 100 || (endingStart > 0 && time >= endingStart), startedAgain = Boolean(previous?.completed && time < 60 && time < (previous.position ?? 0)), rewatchArmed = startedAgain || previous?.rewatchArmed === true, firstCompletion = reachedEnd && !previous?.completed, repeatCompletion = reachedEnd && rewatchArmed, delta = previous && time >= previous.position && time - previous.position <= 90 ? time - previous.position : 0, originEpisodeKey = current?.originAnimeId && current.originNumber ? `${current.originAnimeId}:${current.originNumber}` : undefined;
    const completedNow = firstCompletion || repeatCompletion, updatedAt = Date.now();
    const value: AnimeProgress = { episode, dub, season: selectedSeason, seasonLabel: selectedGroup?.label, originAnimeId: current?.originAnimeId, originEpisode: current?.originNumber, totalEpisodes: totalAcrossSeasons || episodes.length, totalDuration: totalDurationAcrossSeasons || snapshot?.totalDuration, episodes: { ...(snapshot?.episodes ?? {}), [episodeKey]: { position: time, duration, percent, originAnimeId: current?.originAnimeId ?? previous?.originAnimeId, originEpisode: current?.originNumber ?? previous?.originEpisode, completed: previous?.completed || reachedEnd, completions: (previous?.completions ?? (previous?.completed ? 1 : 0)) + (completedNow ? 1 : 0), completionHistory: completedNow ? [...(previous?.completionHistory ?? []), updatedAt] : previous?.completionHistory, rewatchArmed: repeatCompletion ? false : rewatchArmed, watchedSeconds: (previous?.watchedSeconds ?? Math.min(previous?.position ?? 0, previous?.duration || previous?.position || 0)) + Math.max(0, delta), updatedAt } } };
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
  const chooseEpisode = (nextEpisode: string, nextSeason = selectedSeason, scrollToPlayer = true) => { setShowUpcoming(false); setSelectedSeason(nextSeason); setEpisode(nextEpisode); setPlayer(""); if (scrollToPlayer && autoScrollPlayer) requestAnimationFrame(() => requestAnimationFrame(() => playerShell.current?.scrollIntoView({ behavior: "smooth", block: "start" }))) ;};
  const activateCarouselItem = (item: (typeof carouselItems)[number], direction: "previous" | "next", play = true, scrollToPlayer = true) => { setCarouselMotion(""); requestAnimationFrame(() => setCarouselMotion(direction)); setTimeout(() => setCarouselMotion(""), 520); setAutoPlay(play); chooseEpisode(item.number, item.season, scrollToPlayer) ;};
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
      if (key === "kodik_player_time_update") {
        const time = Number(val.time ?? val.currentTime ?? val);
        const duration = Number(val.duration ?? current?.duration ?? 0);
        if (Number.isFinite(time)) {
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
          if (autoSkip && openingEnd && time >= current!.skips!.opening!.time && time < openingEnd) command("seek", { seconds: openingEnd });
          if (autoSkipEnding && endingStart && time >= endingStart && time < endingEnd) {
            save(endingStart, duration, true);
            command("seek", { seconds: endingEnd });
          }
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
        save(Number(current?.duration ?? 0), Number(current?.duration ?? 0), true);
        if (autoNext) {
          const next = carouselIndex >= 0 ? carouselItems[carouselIndex + 1] : undefined;
          if (next) activateCarouselItem(next, "next", true, false);
        }
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
  const setToolbar = (p: ToolbarPosition) => { setPosition(p); write(K.toolbar, p) ;};
  const partyPanel = initialPrefs.watchPartyEnabled ? <section className={`watch-party-panel party-${initialPrefs.watchPartyPanelPosition} ${party.session ? "connected" : ""}`}>
    <div className="watch-party-head"><b>Совместный просмотр</b>{party.session && <span>Комната <strong>{party.session.roomId}</strong> · {party.session.role === "host" ? "вы хост" : "участник"} · {initialPrefs.watchPartyMode === "follow" ? (party.party?.roomMode === "shared" ? "общее управление" : "следуете за хостом") : "свободный просмотр / медленный интернет"}</span>}</div>
    {!party.session ? <div className="watch-party-connect"><button onClick={() => void party.createRoom()}>Создать комнату</button><label><input value={partyRoomCode} onChange={event => setPartyRoomCode(event.target.value.toUpperCase())} placeholder="Код комнаты" maxLength={8} /><button disabled={!partyRoomCode.trim()} onClick={() => void party.joinRoom(partyRoomCode)}>Подключиться</button></label></div> :
      <><div className="watch-party-room-rule">{party.session.role === "host" ? <label title="Только хост: управляет всеми один хост. Общее управление: любой синхронизированный участник может поставить паузу, запустить или переключить серию.">Правило комнаты<select value={initialPrefs.watchPartyRoomMode} onChange={event => persistPrefs({ ...initialPrefs, watchPartyRoomMode: event.target.value as "host" | "shared" })}><option value="host">Все следуют за хостом</option><option value="shared">Все управляют на равных</option></select></label> : <small>Правило комнаты: <b>{party.party?.roomMode === "shared" ? "все управляют на равных" : "все следуют за хостом"}</b></small>}<small>Личный свободный режим можно включить в любой момент — он не меняет режим всей комнаты.</small></div><div className="party-participants">{party.party?.participants.map(participant => <article key={participant.id} className={participant.online ? "" : "offline"}><i /><span><b>{participant.name}{participant.role === "host" ? " · Хост" : ""}</b><small>{participant.playback ? `Сезон ${participant.playback.season} · серия ${participant.playback.episode} · ${formatTime(participant.playback.position)}` : "Подключается…"} · {participant.mode === "follow" ? "синхронизирован" : "свободно"}</small></span>{participant.buffering && <em>Загрузка</em>}{party.session?.role === "host" && participant.role !== "host" && participant.online && <button type="button" onClick={() => void party.transferHost(participant.id)}>Передать хоста</button>}</article>)}</div><div className="watch-party-actions">{initialPrefs.watchPartyMode === "free" && <button onClick={party.catchUp}>Перейти к общему таймкоду</button>}<button className="danger" onClick={() => void party.leaveRoom()}>Покинуть</button></div></>}
    {suggestedHostDub && <div className="party-dub-suggestion"><span>Хост смотрит в озвучке <b>{suggestedHostDub}</b>. Переключиться?</span><button onClick={acceptHostDub}>Переключиться</button><button onClick={() => { dismissedHostDub.current = suggestedHostDub; setSuggestedHostDub(null); }}>Оставить мою</button></div>}
    {partyDubNotice && <small className="watch-party-notice">{partyDubNotice}</small>}
    {party.session && !/kodik/i.test(current?.data.player ?? player) && <small className="watch-party-notice">Для этого источника синхронизация серии и озвучки работает, но точные таймкоды, пауза и перемотка могут не поддерживаться. Для полной синхронизации выбери Kodik.</small>}
    {party.error && <small className="watch-party-error">{party.error}</small>}
  </section> : null;
  return <main className="app">{header}
    <section className="watch-shell"><button className="back" onClick={onBack}>← Каталог</button>
      <div className="watch-heading"><div><span className="eyebrow">{showUpcoming && upcomingRow ? `${upcomingRow.group.label?.toUpperCase() ?? `СЕЗОН ${upcomingSeason}`} · СЕРИЯ ${upcomingEpisode}` : `${selectedGroup?.label?.toUpperCase() ?? `СЕЗОН ${selectedSeason}`} · ${current?.contentKind ?? (selectedGroup?.kind === "movie" ? "ФИЛЬМ" : "СЕРИЯ")} ${episode}`}</span><h1>{base}</h1></div><b>★ {anime.rating?.average?.toFixed(1) ?? "—"}</b></div><div className="season-tabs">{seasons.map(s => <button className={`${s.number === selectedSeason ? "active " : ""}${s.kind === "special" ? "extra" : ""}`.trim()} key={s.number} onClick={() => { setShowUpcoming(false); setSelectedSeason(s.number) ;}}>{s.label ?? `Сезон ${s.number}`}</button>)}</div>
      <div ref={playerShell} className={`episode-carousel ${episodeCarousel ? "enabled" : "disabled"} ${carouselMotion ? `shift-${carouselMotion}` : ""}`}>{episodeCarousel && previousCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-previous" images={episodePreviewImages(previousCarouselItem.entry, previousCarouselItem.video?.originNumber ?? previousCarouselItem.number)} fallback={previousCarouselItem.entry?.poster?.fullsize ?? previousCarouselItem.entry?.poster?.big} label={previousCarouselItem.group.label ?? `Сезон ${previousCarouselItem.season}`} sublabel={`${previousCarouselItem.video?.contentKind ?? "Серия"} ${previousCarouselItem.number}`} onClick={() => activateCarouselItem(previousCarouselItem, "previous")} /> : episodeCarousel ? <span className="carousel-space" /> : null}
      {initialPrefs.watchPartyPanelPosition === "top" && partyPanel}
      <div className={`video-layout ${showUpcoming ? "upcoming-layout" : `toolbar-${position}`}`}>
      <div className={`player-frame ${showUpcoming ? "upcoming-frame" : ""}`}>{showUpcoming && upcomingRow ? <div className="upcoming-player"><span>СЛЕДУЮЩАЯ СЕРИЯ</span><b>{upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия {upcomingEpisode}{upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}</b><time>{formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}</time><small>{upcomingRow.item?.episodes?.aired ?? 0} серий уже вышло · следующая ещё недоступна</small></div> : <>{current && <iframe ref={iframe} key={current.video_id} src={iframeSource} onLoad={loaded} title={`${base}, ${selectedGroup?.label ?? `серия ${episode}`}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}{status && <div className="player-status"><span>{status}</span>{!current && !status.includes("Загружаем") && <button onClick={() => void fetchVideos()}>Повторить загрузку</button>}</div>}</>}</div>
      {!showUpcoming && <div className="player-toolbar"><label>Озвучка<select value={dub} onChange={e => { setDub(e.target.value); chooseEpisode(videos.find(v => v.data.dubbing === e.target.value)?.number ?? "1") ;}}>{dubs.map(x => <option key={x} value={x}>{x}</option>)}</select></label><label>Серия<select value={episode} onChange={e => chooseEpisode(e.target.value)}>{episodes.map(x => { const duration = episodeDuration(videos, x), watched = isEpisodeWatched(saved?.episodes[`${selectedSeason}:${x}`]); return <option key={x} value={x}>{x}{duration ? ` · ${formatDuration(duration)}` : ""}{watched ? " · Просмотрено" : ""}</option> ;})}</select></label><label>Источник<select value={current?.data.player ?? player} onChange={e => setPlayer(e.target.value)}>{players.map(x => <option key={x} value={x}>{x}</option>)}</select></label>{openingEnd > 0 && <button onClick={() => command("seek", { seconds: openingEnd })}>Пропустить опенинг → {formatTime(openingEnd)}</button>}{endingStart > 0 && <button onClick={() => { save(endingStart, current?.duration ?? 0, true); command("seek", { seconds: endingEnd }) ;}}>Пропустить эндинг → {formatTime(endingEnd)}</button>}<details className="compact-options player-options" onClick={event => { if (event.target === event.currentTarget && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false ;} }}><summary>⚙ Настройки просмотра</summary><div><Toggle label="Автоскип опенинга" value={autoSkip} onChange={v => { setAutoSkipState(v); persistPrefs( { ...initialPrefs, autoSkipOpening: v, autoSkipEnding, autoNext, autoPlayResume, autoScrollPlayer, playerEpisodeCarousel: episodeCarousel }) ;}} /><Toggle label="Автоскип эндинга" value={autoSkipEnding} onChange={v => { setAutoSkipEndingState(v); persistPrefs( { ...initialPrefs, autoSkipOpening: autoSkip, autoSkipEnding: v, autoNext, autoPlayResume, autoScrollPlayer, playerEpisodeCarousel: episodeCarousel }) ;}} /><Toggle label="Автосерия" value={autoNext} onChange={v => { setAutoNextState(v); persistPrefs( { ...initialPrefs, autoSkipOpening: autoSkip, autoSkipEnding, autoNext: v, autoPlayResume, autoScrollPlayer, playerEpisodeCarousel: episodeCarousel }) ;}} /><Toggle label="Переход к плееру" value={autoScrollPlayer} onChange={v => { setAutoScrollPlayerState(v); persistPrefs( { ...initialPrefs, autoSkipOpening: autoSkip, autoSkipEnding, autoNext, autoPlayResume, autoScrollPlayer: v, playerEpisodeCarousel: episodeCarousel }) ;}} />
<Toggle label="Карусель серий" value={episodeCarousel} onChange={v => { setEpisodeCarousel(v); persistPrefs( { ...initialPrefs, autoSkipOpening: autoSkip, autoSkipEnding, autoNext, autoPlayResume, autoScrollPlayer, playerEpisodeCarousel: v }) ;}} />
<Toggle label="Предпросмотр серии при наведении" value={episodeHoverPreview} onChange={v => { setEpisodeHoverPreview(v); persistPrefs({ ...initialPrefs, autoSkipOpening: autoSkip, autoSkipEnding, autoNext, autoPlayResume, autoScrollPlayer, playerEpisodeCarousel: episodeCarousel, episodeHoverPreview: v }, v) ;}} />
<Toggle label="Совместный режим" value={initialPrefs.watchPartyEnabled} onChange={v => persistPrefs({ ...initialPrefs, watchPartyEnabled: v })} />
{initialPrefs.watchPartyEnabled && <label title="Синхронизация подчиняется правилу комнаты. Свободный режим всегда доступен лично тебе, не принимает общие команды и не отправляет твои действия другим.">Мой режим<select value={initialPrefs.watchPartyMode} onChange={e => persistPrefs({ ...initialPrefs, watchPartyMode: e.target.value as "follow" | "free" })}><option value="follow">Синхронизироваться с комнатой</option><option value="free">Свободный просмотр / Режим медленного интернета</option></select></label>}
{initialPrefs.watchPartyEnabled && <label title="Можно оставить свою озвучку, получать предложение при смене озвучки хостом или переключаться автоматически.">Озвучка в комнате<select value={initialPrefs.watchPartyDubMode} onChange={e => persistPrefs({ ...initialPrefs, watchPartyDubMode: e.target.value as "own" | "suggest" | "follow" })}><option value="own">Своя у каждого</option><option value="suggest">Предлагать озвучку хоста</option><option value="follow">Следовать за озвучкой хоста</option></select></label>}
{initialPrefs.watchPartyEnabled && <label title="Определяет, где рядом с плеером показывается комната и таймкоды участников.">Участники<select value={initialPrefs.watchPartyPanelPosition} onChange={e => persistPrefs({ ...initialPrefs, watchPartyPanelPosition: e.target.value as "top" | "bottom" | "overlay" })}><option value="top">Сверху</option><option value="bottom">Снизу</option><option value="overlay">Поверх плеера</option></select></label>}
<label title="Определяет, с какой стороны плеера расположены выбор озвучки, серии, источника и настройки.">Панель<select value={position} onChange={e => setToolbar(e.target.value as ToolbarPosition)}><option value="bottom">Снизу</option><option value="top">Сверху</option><option value="left">Слева</option><option value="right">Справа</option></select></label></div></details></div>}</div>
      {initialPrefs.watchPartyPanelPosition === "overlay" && partyPanel}
      {episodeCarousel && (nextCarouselItem ? <EpisodeSlideshow className="carousel-side carousel-next" images={episodePreviewImages(nextCarouselItem.entry, nextCarouselItem.video?.originNumber ?? nextCarouselItem.number)} fallback={nextCarouselItem.entry?.poster?.fullsize ?? nextCarouselItem.entry?.poster?.big} label={nextCarouselItem.group.label ?? `Сезон ${nextCarouselItem.season}`} sublabel={`${nextCarouselItem.video?.contentKind ?? "Серия"} ${nextCarouselItem.number}`} onClick={() => activateCarouselItem(nextCarouselItem, "next")} /> : upcomingRow && !showUpcoming ? <EpisodeSlideshow className="carousel-side carousel-next upcoming-preview" images={episodePreviewImages(upcomingRow.entry)} fallback={upcomingRow.entry.poster?.fullsize ?? upcomingRow.entry.poster?.big} label={`${upcomingRow.group.label ?? `Сезон ${upcomingSeason}`} · Серия ${upcomingEpisode}${upcomingTotal > 0 ? ` из ${upcomingTotal}` : ""}`} sublabel={`Выйдет ${formatCalendarDate(upcomingRow.item!.episodes!.next_date!)}`} onClick={() => { setCarouselMotion("next"); setShowUpcoming(true); setTimeout(() => setCarouselMotion(""), 520) ;}} /> : <span className="carousel-space" />)}</div>
      {initialPrefs.watchPartyPanelPosition === "bottom" && partyPanel}
      <div className="watch-info"><div><div className="tags">{anime.genres?.slice(0, 8).map(g => <button type="button" key={g.alias} onClick={() => onGenre(g.title)}>{g.title}</button>)}</div><p>{anime.description}</p><div className="facts"><span>{seasons.length > 1 ? "◆ Франшиза · всё собрано" : "◇ Отдельный тайтл"}</span><span>{seasons.filter(s => s.kind === "season").length} сезонов</span><span>{seasons.flatMap(s => s.entries).filter(isExtraAnime).length} OVA/ONA/спешлов</span><span>{seasons.filter(s => s.kind === "movie").length} фильмов</span><span>{totalAcrossSeasons} видео всего</span><span>{durationRange(Object.values(seasonVideos).flat())}</span></div></div><aside><button onClick={onFavorite}>{favorite ? "♥ В избранном" : "♡ В избранное"}</button><button onClick={onFolders}>＋ Добавить в папку</button><button onClick={() => setTrackOpen(!trackOpen)}>{tracker ? "◉ Настроить отслеживание" : "◎ Следить за франшизой"}</button>{trackOpen && <div className="track-settings"><b>Озвучки всей франшизы</b><label><input type="checkbox" checked={!trackDubs.length} onChange={() => setTrackDubs([])} /> Все озвучки</label>{dubs.map(d => <label key={d}><input type="checkbox" checked={trackDubs.includes(d)} onChange={() => setTrackDubs(v => v.includes(d) ? v.filter(x => x !== d) : [...v, d])} />{d}</label>)}<button onClick={() => { const knownKeys = [...new Set(Object.values(seasonVideos).flat().filter(video => Boolean(video.iframe_url?.trim()) && (!trackDubs.length || trackDubs.includes(video.data.dubbing))).map(video => `${video.originAnimeId}:${video.originNumber}`))]; onTrack(knownKeys.length, trackDubs, seasons.flatMap(s => s.entries.map(e => e.anime_id)), familyRoot, knownKeys); setTrackOpen(false) ;}}>Сохранить</button>{tracker && <button className="danger" onClick={onUntrack}>Отключить</button>}</div>}<button className="danger" onClick={() => { if (confirm("Обнулить весь прогресс этого аниме?")) onProgress({ episode: "1", dub, season: 1, totalEpisodes: totalAcrossSeasons, totalDuration: totalDurationAcrossSeasons, episodes: {} }) ;}}>↺ Обнулить прогресс</button></aside></div>
      {scheduleRows.length > 0 && <section className="release-schedule"><div><span className="eyebrow">ГРАФИК ВЫХОДА</span><h2>Следующие серии</h2></div>{scheduleRows.map(({ group, entry, item }) => { const aired = item.episodes?.aired ?? 0, total = item.episodes?.count ?? 0; return <article key={entry.anime_id}><span><b>{group.label}</b><small>{aired} из {total || "—"} серий вышло · следующая — серия {aired + 1}{total ? ` из ${total}` : ""}</small></span><time>{formatCalendarDate(item.episodes!.next_date!)}</time></article> ;})}</section>}
      <div className="all-seasons">{seasons.map(group => { const list = seasonVideos[group.number] ?? [], nums = Array.from(new Set(list.map(v => v.number))).sort((a, b) => +a - +b), watched = nums.filter(e => isEpisodeWatched(saved?.episodes[`${group.number}:${e}`])).length, allWatched = nums.length > 0 && watched === nums.length, entry = group.entries[0], planned = releaseStatus(entry).kind === "planned", airing = releaseStatus(entry).kind === "airing", scheduleItem = group.entries.map(e => schedule[e.anime_id]).find(Boolean), date = scheduleItem?.episodes?.next_date, collapsed = collapsedSeasons.includes(group.number), emptyMessage = planned ? `Запланировано${entry.year ? ` · ${entry.year}` : ""}` : airing ? date ? `Следующая серия · ${formatCalendarDate(date)}` : "Сейчас выходит · дата следующей серии не указана" : "Видео пока не добавлено"; return <section className={`season-panel ${collapsed ? "collapsed " : ""}${group.kind === "special" ? "extra-panel" : ""}`.trim()} key={group.number}><div className="season-summary-row"><button type="button" className="season-summary" onClick={() => toggleSeason(group.number)} aria-expanded={!collapsed}><h2>{group.label ?? `Сезон ${group.number}`}</h2><span>{watched} из {nums.length} просмотрено</span><b>{collapsed ? "⌄" : "⌃"}</b></button><button type="button" className={`season-watch-toggle ${allWatched ? "active" : ""}`} disabled={!nums.length} aria-label={allWatched ? `Снять отметку «просмотрено» со всех серий: ${group.label ?? `Сезон ${group.number}`}` : `Отметить все серии просмотренными: ${group.label ?? `Сезон ${group.number}`}`} title={allWatched ? "Снять отметку со всего сезона" : "Отметить весь сезон просмотренным и учесть длительность серий в статистике"} onClick={() => toggleSeasonWatched(group.number, nums, list)}><span className="eye-glyph" /></button></div><div className="season-progress"><i style={{ width: `${nums.length ? watched / nums.length * 100 : 0}%` }} /></div><div className="season-content"><div>{!nums.length && <div className={`release-empty ${planned ? "planned" : airing ? "airing" : ""}`}><i />{emptyMessage}</div>}<div className="episode-grid">{nums.map(e => { const key = `${group.number}:${e}`, ep = saved?.episodes[key], isWatched = isEpisodeWatched(ep), isActive = group.number === selectedSeason && e === episode, isNew = newEpisodeKeys.has(key) && !isWatched, duration = episodeDuration(list, e), video = list.find(v => v.number === e), originEntry = group.entries.find(item => item.anime_id === video?.originAnimeId) ?? entry, previewAnime = previewAnimeById[originEntry.anime_id] ?? originEntry, unit = video?.contentKind ?? (group.kind === "movie" ? "Фильм" : "Серия"); return <EpisodeHoverPreview key={e} enabled={episodeHoverPreview} images={episodePreviewImages(previewAnime, video?.originNumber ?? e)} fallback={previewAnime.poster?.fullsize ?? previewAnime.poster?.big} label={`${group.label ?? `Сезон ${group.number}`} · ${unit} ${e}`}>
  <div className="episode-card-shell">
    <button className={`episode-entry ${isActive ? "active " : ""}${isWatched ? "watched " : ""}${isNew ? "new-episode " : ""}${unit !== "Серия" && unit !== "Фильм" ? "extra-episode" : ""}`.trim()} onClick={() => chooseEpisode(e, group.number)}><b>{e}{isWatched && <i>✓</i>}</b><span>{unit} {e}{isNew && <em>НОВАЯ</em>}<small>{duration ? formatDuration(duration) : "Длительность неизвестна"} · {isWatched ? "Просмотрено" : `${ep?.percent ?? 0}% · ${formatTime(ep?.position ?? 0)}`}</small></span></button>
    <button
      type="button"
      className={`episode-watch-toggle ${isWatched ? "active" : ""}`}
      aria-label={isWatched ? `Снять отметку «просмотрено» с ${unit.toLowerCase()} ${e}` : `Отметить ${unit.toLowerCase()} ${e} просмотренной`}
      title={isWatched ? "Снять отметку «просмотрено»" : "Отметить просмотренной и учесть полную длительность в статистике"}
      onClick={(event) => {
        event.stopPropagation();
        toggleWatched(group.number, e, duration, video);
      }}
    >
      <span className="eye-glyph" aria-hidden="true" />
    </button>
  </div>
</EpisodeHoverPreview> ;})}</div></div></div></section> ;})}</div>
    </section>{folderPicker && <FolderPicker anime={folderPicker} folders={folders} onToggle={toggleFolder} onCreate={createFolder} onClose={closePicker} />}</main>;
}
