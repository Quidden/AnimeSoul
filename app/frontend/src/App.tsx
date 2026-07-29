import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ReleaseMark } from "./components/ReleaseMark";
import { CollectionOverview, type CollectionOverviewKind } from "./components/CollectionOverview";
import { AnimeCard } from "./components/AnimeCard";
import { Watch } from "./components/Player";
import { EpisodeSlideshow, episodePreviewImages } from "./components/EpisodeSlideshow";
import { FolderPicker } from "./components/FolderPicker";
import { Brand, Header } from "./components/Header";
import { Toggle } from "./components/Toggle";
import { useEpisodeTracking } from "./hooks/useEpisodeTracking";
import { useWatchPartyPresence } from "./hooks/useWatchParty";
import { acknowledgeTrackedEpisode } from "./lib/tracking";
import type { Anime, AnimeProgress, ApiStatus, CardMeta, ConfigProfile, ConfigSnapshot, Folder, PlayerPrefs, Progress, SaveStatus, ScheduleEntry, SeasonGroup, StorageDocument, Theme, ToolbarPosition, Tracker, Video } from "./lib/types";
import { DEFAULT_PLAYER_PREFS, SCHEMA_VERSION, STORAGE_KEYS as K, THEMES } from "./lib/settings";
import { migrateDocument, migrateSnapshot, readLocal as read, resolveStoredBoolean, saveStorageDocument, STORAGE_URL, writeLocal as write } from "./lib/storage";
import { animeSearchScore, byViewingOrder, durationRange, episodeDuration, episodeResumePosition, fetchFamily, formatCalendarDate, formatDuration, formatLongDuration, formatTime, franchiseKey, franchiseName, groupFranchises, isEpisodeWatched, isExtraAnime, isLightColor, isMovieAnime, isOvaAnime, latestResumePoint, matchesAnimeSearch, partNumber, releaseStatus, reorder, shortEntryTitle, stripPart, watchTimeProgress } from "./lib/anime";
import { APP_VERSION } from "./version";

export default function Home() {
  const [catalog, setCatalog] = useState<Anime[]>([]), [active, setActive] = useState<Anime | null>(null), [resumeRequested, setResumeRequested] = useState(false), [newEpisodeRequested, setNewEpisodeRequested] = useState(false), [query, setQuery] = useState(""), [genre, setGenre] = useState("Все"), [offset, setOffset] = useState(0);
  const [view, setView] = useState<"home" | "catalog" | "stats">("home");
  useEffect(() => { if (active) setView("catalog") ;}, [active]);
  const [loading, setLoading] = useState(false), [catalogReady, setCatalogReady] = useState(false), [error, setError] = useState(""), [favorites, setFavorites] = useState<number[]>([]), [folders, setFolders] = useState<Folder[]>([]), [progress, setProgress] = useState<Progress>({});
  const [tracked, setTracked] = useState<Tracker[]>([]), [libraryOpen, setLibraryOpen] = useState(false), [folderPicker, setFolderPicker] = useState<Anime | null>(null), [openedFolder, setOpenedFolder] = useState<Folder | null>(null), [collectionOverview, setCollectionOverview] = useState<CollectionOverviewKind | null>(null);
  const [lastDeletedFolder, setLastDeletedFolder] = useState<{ folder: Folder; index: number } | null>(null);
  const [sort, setSort] = useState("rating-desc"), [yearFrom, setYearFrom] = useState(""), [yearTo, setYearTo] = useState(""), [theme, setTheme] = useState(THEMES[0]);
  const [randomOpen, setRandomOpen] = useState(false), [randomGenre, setRandomGenre] = useState("Все"), [randomYearFrom, setRandomYearFrom] = useState(""), [randomYearTo, setRandomYearTo] = useState(""), [randomRating, setRandomRating] = useState("0");
  const [groupFilter, setGroupFilter] = useState("all"), [formatFilter, setFormatFilter] = useState("all");
  const [playerPrefs, setPlayerPrefs] = useState<PlayerPrefs>(DEFAULT_PLAYER_PREFS), [cardMeta, setCardMeta] = useState<Record<number, CardMeta>>({});
  const [heroPreviewAnime, setHeroPreviewAnime] = useState<Anime | null>(null);
  const [heroPreviewVideo, setHeroPreviewVideo] = useState<Video | null>(null);
  const [partyHostDetails, setPartyHostDetails] = useState<Anime | null>(null);
  const partyPresence = useWatchPartyPresence({ enabled: view === "home" && playerPrefs.watchPartyEnabled, server: playerPrefs.watchPartyServer });
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]), [activeProfile, setActiveProfile] = useState("default");
  // Retain document-level fields introduced by newer or legacy builds.
  // They travel through autosaves even when this preview does not use them.
  const storageEnvelopeRef = useRef<Partial<StorageDocument>>({});
  const [historyClearedAt, setHistoryClearedAt] = useState(0), [historyEnabled, setHistoryEnabled] = useState(true);
  const [watchingHidden, setWatchingHidden] = useState<number[]>(() => read(K.watchingHidden, []));
  // The server cannot read localStorage. Start collapsed so SSR cannot reopen
  // sections, then restore the actual device preference after hydration.
  const [libraryExpanded, setLibraryExpanded] = useState(false), [watchingExpanded, setWatchingExpanded] = useState(false), [historyExpanded, setHistoryExpanded] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "loading" });
  useEffect(() => {
    setLibraryExpanded(read(K.libraryExpanded, true));
    setWatchingExpanded(read(K.watchingExpanded, true));
    setHistoryExpanded(read(K.historyExpanded, true));
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    setWatchingHidden(read(K.watchingHidden, []));
  }, [storageReady, activeProfile]);
  useEffect(() => { write("animesoul:save-status", saveStatus); window.dispatchEvent(new CustomEvent("animesoul:save-status", { detail: saveStatus })) ;}, [saveStatus]);
  useEffect(() => { const originalFetch = window.fetch.bind(window); let pending = 0, failed = false, settleTimer: ReturnType<typeof setTimeout> | undefined; const report = (status: ApiStatus) => { write("animesoul:api-status", status); window.dispatchEvent(new CustomEvent("animesoul:api-status", { detail: status })) ;}, scheduleSettled = () => { clearTimeout(settleTimer); settleTimer = setTimeout(() => { if (pending > 0) return; const status: ApiStatus = failed ? { state: "error", at: Date.now() } : { state: "updated", at: Date.now() }; failed = false; report(status) ;}, 1200) ;}; const wrapped: typeof window.fetch = async (input, init) => { const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url, isYummy = url.includes("/api/yummy") && !url.includes("silent=1"); if (!isYummy) return originalFetch(input, init); clearTimeout(settleTimer); pending++; report({ state: "updating" }); try { const response = await originalFetch(input, init); if (!response.ok) failed = true; return response ;} catch (error) { failed = true; throw error ;} finally { pending--; if (pending === 0) scheduleSettled() ;} }; window.fetch = wrapped; return () => { clearTimeout(settleTimer); if (window.fetch === wrapped) window.fetch = originalFetch ;} ;}, []);
  useEffect(() => { const loadedFavorites = read<number[]>(K.favorites, []), loadedFolders = read<Folder[]>(K.folders, []), loadedProgress = read<Progress>(K.progress, {}), loadedTracked = read<Tracker[]>(K.tracked, []), loadedTheme = read<Theme>(K.theme, THEMES[0]), loadedToolbar = read<ToolbarPosition>(K.toolbar, "bottom"), loadedHistoryClearedAt = read<number>(K.historyClearedAt, 0), loadedHistoryEnabled = read<boolean>(K.historyEnabled, true), active = localStorage.getItem(K.activeProfile) ?? "default"; let loadedProfiles = read<ConfigProfile[]>(K.profiles, []); if (active === "default" && !loadedProfiles.some(p => p.id === "default")) { loadedProfiles = [{ id: "default", name: "Основной", snapshot: { version: 1, name: "Основной", createdAt: new Date().toISOString(), favorites: loadedFavorites, folders: loadedFolders, progress: loadedProgress, tracked: loadedTracked, theme: loadedTheme, toolbar: loadedToolbar, historyClearedAt: loadedHistoryClearedAt, historyEnabled: loadedHistoryEnabled } }, ...loadedProfiles]; write(K.profiles, loadedProfiles) ;} setFavorites(loadedFavorites); setFolders(loadedFolders); setProgress(loadedProgress); setTracked(loadedTracked); setTheme(loadedTheme); setProfiles(loadedProfiles); setActiveProfile(active); setHistoryClearedAt(loadedHistoryClearedAt); setHistoryEnabled(loadedHistoryEnabled) ;}, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(STORAGE_URL, { cache: "no-store" });
        if (response.ok) {
          const document = migrateDocument(await response.json());
          const profile =
            document.profiles.find(item => item.id === document.activeProfile) ??
            document.profiles[0];
          const snapshot = migrateSnapshot(profile.snapshot, profile.name);
          if (cancelled) return;
          storageEnvelopeRef.current = document;
          applySnapshot(snapshot);
          setFavorites(snapshot.favorites);
          setFolders(snapshot.folders);
          setProgress(snapshot.progress);
          setTracked(snapshot.tracked);
          setTheme(snapshot.theme);
          setPlayerPrefs(snapshot.playerPrefs ?? DEFAULT_PLAYER_PREFS);
          setHistoryClearedAt(snapshot.historyClearedAt ?? 0);
          setHistoryEnabled(snapshot.historyEnabled !== false);
          setProfiles(document.profiles);
          setActiveProfile(profile.id);
          write(K.profiles, document.profiles);
          localStorage.setItem(K.activeProfile, profile.id);
        } else if (response.status === 404) {
          const localSnapshot = migrateSnapshot({
            name: "Основной",
            favorites: read(K.favorites, []),
            folders: read(K.folders, []),
            progress: read(K.progress, {}),
            tracked: read(K.tracked, []),
            theme: read(K.theme, THEMES[0]),
            toolbar: read(K.toolbar, "bottom"),
            playerPrefs: read(K.playerPrefs, DEFAULT_PLAYER_PREFS),
            historyClearedAt: read(K.historyClearedAt, 0),
            historyEnabled: read(K.historyEnabled, true),
          });
          const localProfiles = read<ConfigProfile[]>(K.profiles, []).map(profile => ({
            ...profile,
            snapshot: migrateSnapshot(profile.snapshot, profile.name),
          }));
          const active = localStorage.getItem(K.activeProfile) ?? "default";
          const document = migrateDocument({
            activeProfile: active,
            profiles: localProfiles.length
              ? localProfiles
              : [{ id: "default", name: "Основной", snapshot: localSnapshot }],
          });
          storageEnvelopeRef.current = document;
          const saved = await saveStorageDocument(document);
          if (!saved.ok) throw Error("Storage unavailable");
        }
        if (!cancelled) setSaveStatus({ state: "saved", at: Date.now() });
      } catch (error) {
        console.warn(
          "Локальное файловое хранилище недоступно, используется резервная копия браузера",
          error,
        );
        if (!cancelled) setSaveStatus({ state: "error" });
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => { document.documentElement.style.setProperty("--accent", theme.accent); document.documentElement.style.setProperty("--accent-soft", `${theme.accent}33`); document.documentElement.style.setProperty("--bg", theme.background); document.documentElement.dataset.colorScheme = isLightColor(theme.background) ? "light" : "dark"; document.documentElement.style.colorScheme = isLightColor(theme.background) ? "light" : "dark"; document.body.style.backgroundColor = theme.background; write(K.theme, theme) ;}, [theme]);
  useEffect(() => {
    const root = document.documentElement, prefs = { ...DEFAULT_PLAYER_PREFS, ...playerPrefs };
    root.style.setProperty("--watched-episode-color", prefs.watchedEpisodeColor);
    root.style.setProperty("--interface-font-scale", String(prefs.interfaceFontScale));
    root.style.setProperty("--heading-font-scale", String(prefs.headingFontScale));
    root.style.setProperty("--poster-scale", String(prefs.posterScale));
    root.style.setProperty("--preview-scale", String(prefs.previewScale));
  }, [playerPrefs]);
  useEffect(() => setPlayerPrefs(current => ({ ...current, ...read<Partial<PlayerPrefs>>(K.playerPrefs, {}) })), []);
  const load = async (next = 0, append = false, q = query) => { setCatalogReady(true); setLoading(true); setError(""); try { const r = await fetch(`/api/yummy?mode=catalog&limit=24&offset=${next}&q=${encodeURIComponent(q)}`), p = await r.json(); if (!r.ok) throw Error(p.error); setCatalog(c => append ? [...new Map([...c, ...p.anime].map(a => [a.anime_id, a])).values()] : p.anime); setOffset(next) ;} catch (e) { setError(e instanceof Error ? e.message : "Ошибка каталога") ;} finally { setLoading(false) ;} };
  const loadMore = async () => { setLoading(true); setError(""); try { const existingIds = new Set(catalog.map(a => a.anime_id)), matches = (a: Anime) => { const familyCount = a.franchiseCount ?? 1, isMovie = isMovieAnime(a); return (genre === "Все" || a.genres?.some(g => g.title === genre)) && (!yearFrom || (a.year ?? 0) >= +yearFrom) && (!yearTo || (a.year ?? 9999) <= +yearTo) && (groupFilter === "all" || (groupFilter === "franchise" ? familyCount > 1 : familyCount === 1)) && (formatFilter === "all" || (formatFilter === "movie" ? isMovie : !isMovie)) ;}, before = new Set(groupFranchises(catalog).filter(matches).map(a => franchiseKey(a.title))); let cursor = offset + 24, fresh: Anime[] = [], addedCards = 0; for (let attempt = 0; attempt < 5 && addedCards < 12; attempt++) { const r = await fetch(`/api/yummy?mode=catalog&limit=48&offset=${cursor}`), p = await r.json(); if (!r.ok) throw Error(p.error); const page = (p.anime ?? []) as Anime[]; for (const anime of page) if (!existingIds.has(anime.anime_id)) { existingIds.add(anime.anime_id); fresh.push(anime) ;} cursor += 48; addedCards = groupFranchises([...catalog, ...fresh]).filter(matches).filter(a => !before.has(franchiseKey(a.title))).length; if (page.length < 48) break; if (addedCards < 12) await new Promise(resolve => setTimeout(resolve, 120)) ;} setCatalog(current => [...new Map([...current, ...fresh].map(a => [a.anime_id, a])).values()]); setOffset(cursor - 24); if (!fresh.length) setError("Больше новых аниме в каталоге не найдено") ;} catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить новые аниме") ;} finally { setLoading(false) ;} };
  useEffect(() => { if (view === "catalog" && !active && !catalogReady) void load(0, false, "") ;}, [view, active, catalogReady]);
  const storedIds = useMemo(() => Array.from(new Set([...favorites, ...folders.flatMap(f => f.animeIds), ...Object.keys(progress).map(Number)])), [favorites, folders, progress]);
  useEffect(() => { if (active) return; const missing = storedIds.filter(id => !catalog.some(a => a.anime_id === id)); if (!missing.length) return; fetch(`/api/yummy?mode=details&ids=${missing.join(",")}`).then(r => r.json()).then(p => setCatalog(current => [...current, ...((p.anime ?? []) as Anime[]).filter(a => !current.some(x => x.anime_id === a.anime_id))])).catch(() => { }) ;}, [storedIds.join(","), catalog.length, active]);
  const idsNeedingStats = useMemo(() => storedIds.filter(id => !((progress[id]?.totalEpisodes ?? 0) > 0)), [storedIds, progress]);
  useEffect(() => { if (view !== "home" || active || !idsNeedingStats.length) return; let cancelled = false; (async () => { const rows: (readonly [number, number, number])[] = []; for (const id of idsNeedingStats) { if (cancelled) break; try { const r = await fetch(`/api/yummy?mode=videos&id=${id}`), p = await r.json(); if (r.ok) { const videos = p.videos as Video[], unique = [...new Map(videos.map(v => [v.number, v])).values()]; rows.push([id, unique.length, unique.reduce((sum, v) => sum + (v.duration ?? 0), 0)]) ;} } catch { } await new Promise(resolve => setTimeout(resolve, 180)) ;} if (cancelled || !rows.length) return; setProgress(current => { const next = { ...current }; for (const [id, total, totalDuration] of rows) next[id] = { episode: next[id]?.episode ?? "1", dub: next[id]?.dub ?? "", season: next[id]?.season ?? 1, episodes: next[id]?.episodes ?? {}, totalEpisodes: total, totalDuration }; write(K.progress, next); return next ;}) ;})(); return () => { cancelled = true ;} ;}, [idsNeedingStats.join(","), view, active]);
  useEpisodeTracking({ tracked, setTracked, view, active });
  const saveFav = (v: number[]) => { setFavorites(v); write(K.favorites, v) ;}, saveFolders = (v: Folder[]) => { setFolders(v); write(K.folders, v) ;}, saveProgress = (v: Progress) => { setProgress(v); write(K.progress, v) ;}, saveTracked = (v: Tracker[]) => { setTracked(v); write(K.tracked, v) ;};
  const toggleFavorite = (id: number) => saveFav(favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]);
  const createFolder = () => { const name = prompt("Название новой папки")?.trim(); if (name) { const next = [...folders, { id: crypto.randomUUID(), name, animeIds: [] }]; saveFolders(next); return next.at(-1) ;} };
  const toggleFolder = (folder: Folder, id: number) => saveFolders(folders.map(f => f.id === folder.id ? { ...f, animeIds: f.animeIds.includes(id) ? f.animeIds.filter(x => x !== id) : [...f.animeIds, id] } : f));
  const deleteFolder = (folder: Folder) => {
    const deleted = { folder, index: Math.max(0, folders.findIndex(item => item.id === folder.id)) };
    setLastDeletedFolder(deleted);
    write("animesoul:last-deleted-folder", deleted);
    saveFolders(folders.filter(item => item.id !== folder.id));
    if (openedFolder?.id === folder.id) setOpenedFolder(null);
  };
  const restoreLastFolder = () => {
    if (!lastDeletedFolder || folders.some(folder => folder.id === lastDeletedFolder.folder.id)) return;
    const next = [...folders];
    next.splice(Math.min(lastDeletedFolder.index, next.length), 0, lastDeletedFolder.folder);
    saveFolders(next);
    setLastDeletedFolder(null);
    localStorage.removeItem("animesoul:last-deleted-folder");
  };
  useEffect(() => setLastDeletedFolder(
    read<{ folder: Folder; index: number } | null>("animesoul:last-deleted-folder", null),
  ), []);
  const known = (id: number) => catalog.find(a => a.anime_id === id);
  const partyHost = partyPresence.party?.participants.find(participant => participant.role === "host");
  const partyHostPlayback = partyHost?.playback;
  const partyHostAnime = partyHostPlayback ? known(partyHostPlayback.animeId) ?? (partyHostDetails?.anime_id === partyHostPlayback.animeId ? partyHostDetails : null) : null;
  useEffect(() => {
    if (!partyHostPlayback || known(partyHostPlayback.animeId)) {
      setPartyHostDetails(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/yummy?mode=details&ids=${partyHostPlayback.animeId}`)
      .then(response => response.json())
      .then(payload => {
        if (!cancelled) setPartyHostDetails((payload.anime?.[0] as Anime | undefined) ?? null);
      })
      .catch(() => { if (!cancelled) setPartyHostDetails(null) ;});
    return () => { cancelled = true ;};
  }, [partyHostPlayback?.animeId, catalog.length]);
  const genres = useMemo(() => ["Все", ...Array.from(new Set(catalog.flatMap(a => a.genres?.map(g => g.title) ?? []))).slice(0, 14)], [catalog]);
  const searchedCatalog = useMemo(() => query.trim() ? catalog.filter(anime => matchesAnimeSearch(anime, query)) : catalog, [catalog, query]);
  const franchises = useMemo(() => {
    const grouped = groupFranchises(searchedCatalog);
    if (!query.trim()) return grouped;
    return grouped.sort(
      (left, right) => animeSearchScore(right, query) - animeSearchScore(left, query),
    );
  }, [searchedCatalog, query]);
  const visible = useMemo(() => franchises.filter(a => { const meta = cardMeta[a.anime_id], familyCount = meta?.familyCount ?? a.franchiseCount ?? 1, isMovie = isMovieAnime(a); return (genre === "Все" || a.genres?.some(g => g.title === genre)) && (!yearFrom || (a.year ?? 0) >= +yearFrom) && (!yearTo || (a.year ?? 9999) <= +yearTo) && (groupFilter === "all" || !meta || (groupFilter === "franchise" ? familyCount > 1 : familyCount === 1)) && (formatFilter === "all" || (formatFilter === "movie" ? isMovie : !isMovie)) ;}).sort((a, b) => sort === "rating-desc" ? (b.rating?.average ?? 0) - (a.rating?.average ?? 0) : sort === "rating-asc" ? (a.rating?.average ?? 0) - (b.rating?.average ?? 0) : sort === "year-desc" ? (b.year ?? 0) - (a.year ?? 0) : sort === "year-asc" ? (a.year ?? 0) - (b.year ?? 0) : (b.views ?? 0) - (a.views ?? 0)), [franchises, genre, yearFrom, yearTo, sort, groupFilter, formatFilter, cardMeta]);
  const randomCandidates = useMemo(() => franchises.filter(a => (randomGenre === "Все" || a.genres?.some(g => g.title === randomGenre)) && (!randomYearFrom || (a.year ?? 0) >= +randomYearFrom) && (!randomYearTo || (a.year ?? 9999) <= +randomYearTo) && (a.rating?.average ?? 0) >= +randomRating), [franchises, randomGenre, randomYearFrom, randomYearTo, randomRating]);
  useEffect(() => { if (active) return; const allowed = view === "catalog" ? franchises : franchises.filter(anime => storedIds.includes(anime.anime_id)), targets = allowed.filter(a => !cardMeta[a.anime_id]); if (!targets.length) return; let cancelled = false; (async () => { for (const anime of targets) { if (cancelled) break; try { const root = franchiseName(anime.title), family = await fetchFamily(anime, root), members = family.length ? family : [anime], movies = members.filter(isMovieAnime), series = members.filter(a => !isMovieAnime(a) && !isExtraAnime(a)), arcCount = new Set(series.map(a => stripPart(a.title))).size, numberedSeasons = new Set(series.map(a => a.season).filter((n): n is number => typeof n === "number")).size, seasonCount = Math.max(arcCount, numberedSeasons, series.length > 1 ? 2 : series.length), movieCount = movies.length, statusSource = members.find(a => releaseStatus(a).kind === "airing") ?? members.find(a => releaseStatus(a).kind === "planned") ?? anime, status = releaseStatus(statusSource), videoResponse = await fetch(`/api/yummy?mode=videos&id=${anime.anime_id}`), videoPayload = await videoResponse.json(), videos = (videoPayload.videos ?? []) as Video[], unique = [...new Map(videos.map(v => [v.number, v])).values()], durations = unique.map(v => v.duration ?? 0).filter(Boolean), meta: CardMeta = { familyCount: Math.max(1, seasonCount + movieCount), seasonCount, movieCount, episodes: unique.length, durationMin: durations.length ? Math.min(...durations) : 0, durationMax: durations.length ? Math.max(...durations) : 0, status }, shared = Object.fromEntries(members.map(member => [member.anime_id, meta])); if (!cancelled) setCardMeta(current => ({ ...current, ...shared, [anime.anime_id]: meta })) ;} catch { } await new Promise(resolve => setTimeout(resolve, 120)) ;} })(); return () => { cancelled = true ;} ;}, [franchises.map(a => a.anime_id).join(","), storedIds.join(","), view, active]);
  const last = useMemo(() => Object.entries(progress)
    .map(([animeId, item]) => ({ animeId, item, point: latestResumePoint(item) }))
    .filter(entry => entry.point && episodeResumePosition(entry.point.state) > 0)
    .sort((a, b) => (b.point?.state.updatedAt ?? 0) - (a.point?.state.updatedAt ?? 0))[0], [progress]);
  const lastAnime = last ? known(+last.animeId) : undefined, lastState = last?.item;
  const lastPoint = useMemo(() => latestResumePoint(lastState), [lastState]);
  const lastDisplayEpisode = lastPoint?.episode && Number(lastPoint.episode) > 0
    ? lastPoint.episode
    : lastState?.episode && Number(lastState.episode) > 0
      ? lastState.episode
      : "1";
  useEffect(() => {
    if (view !== "home") return;

    const handleDashboardClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const resumeLabel = target.closest(".hero-content > .eyebrow");
      if (resumeLabel?.textContent?.trim() === "ПРОДОЛЖИТЬ ПРОСМОТР" && lastAnime && lastState) {
        setResumeRequested(true);
        setActive(lastAnime);
        return;
      }

      // Buttons inside a summary card retain their own actions. A click on any
      // other part of the card opens the corresponding detailed overview.
      if (target.closest("button, a, input, select, textarea, details")) return;
      const card = target.closest(".hero-widgets > .hero-box");
      if (!card) return;
      const cards = [...document.querySelectorAll(".hero-widgets > .hero-box")];
      const index = cards.indexOf(card);
      if (index === 0) setCollectionOverview("favorites");
      if (index === 1) setCollectionOverview("folders");
      if (index === 2) setCollectionOverview("tracking");
    };

    document.addEventListener("click", handleDashboardClick);
    return () => document.removeEventListener("click", handleDashboardClick);
  }, [view, lastAnime, lastState]);
  useEffect(() => { if (!lastAnime || !playerPrefs.homeEpisodePreview) { setHeroPreviewAnime(null); return ;} let cancelled = false; fetch(`/api/yummy?mode=details&ids=${lastState?.originAnimeId ?? lastAnime.anime_id}`).then(r => r.json()).then(payload => { if (!cancelled) setHeroPreviewAnime((payload.anime?.[0] as Anime | undefined) ?? lastAnime) ;}).catch(() => { if (!cancelled) setHeroPreviewAnime(lastAnime) ;}); return () => { cancelled = true ;} ;}, [lastAnime?.anime_id, lastState?.originAnimeId, playerPrefs.homeEpisodePreview]);
  useEffect(() => {
    if (!lastAnime || !lastState || !lastPoint || !playerPrefs.homeEpisodePreview || playerPrefs.homePreviewMode !== "screenshots") {
      setHeroPreviewVideo(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/yummy?mode=videos&id=${lastState.originAnimeId ?? lastAnime.anime_id}`)
      .then(response => response.json())
      .then(payload => {
        if (cancelled) return;
        const videos = (payload.videos ?? []) as Video[];
        const episodeVideos = videos.filter(video => video.number === (lastState.originEpisode ?? lastPoint.episode));
        setHeroPreviewVideo(
          episodeVideos.find(video => video.data.dubbing === lastState.dub && /kodik/i.test(video.data.player))
          ?? episodeVideos.find(video => /kodik/i.test(video.data.player))
          ?? episodeVideos[0]
          ?? null,
        );
      })
      .catch(() => { if (!cancelled) setHeroPreviewVideo(null) ;});
    return () => { cancelled = true ;};
  }, [lastAnime?.anime_id, lastState?.originAnimeId, lastState?.originEpisode, lastPoint?.episode, lastState?.dub, playerPrefs.homeEpisodePreview, playerPrefs.homePreviewMode]);
  const historyItems = useMemo(() => historyEnabled ? Object.entries(progress).flatMap(([animeId, item]) => Object.entries(item.episodes).filter(([, state]) => state.updatedAt > historyClearedAt).map(([key, state]) => { const [season, episode] = key.split(":"); return { animeId: +animeId, season: +season || 1, episode, state } ;})).sort((a, b) => b.state.updatedAt - a.state.updatedAt).slice(0, 30) : [], [progress, historyClearedAt, historyEnabled]);
  const watchingItems = useMemo(() => Object.entries(progress).flatMap(([animeId, item]) => { const id = +animeId, episodes = Object.entries(item.episodes); if (!episodes.length || watchingHidden.includes(id)) return []; const watched = episodes.filter(([, state]) => isEpisodeWatched(state)).length; if (item.totalEpisodes && watched >= item.totalEpisodes) return []; const [lastKey, lastState] = [...episodes].sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0], [season, episode] = lastKey.split(":"); return [{ animeId: id, item, season: +season || item.season || 1, episode, state: lastState, updatedAt: lastState.updatedAt }]; }).sort((a, b) => b.updatedAt - a.updatedAt), [progress, watchingHidden]);
  const animeProgress = (p?: AnimeProgress) => { if (!p?.totalEpisodes) return 0; const watched = Object.values(p.episodes).filter(isEpisodeWatched).length; return Math.min(100, Math.round(watched / p.totalEpisodes * 100)) ;};
  const folderStats = (f: Folder) => { const total = f.animeIds.reduce((sum, id) => sum + (progress[id]?.totalEpisodes ?? 0), 0); const watched = f.animeIds.reduce((sum, id) => sum + new Set(Object.entries(progress[id]?.episodes ?? {}).filter(([, e]) => isEpisodeWatched(e)).map(([key]) => key)).size, 0); return { total, watched, percent: total ? Math.min(100, Math.round(watched / total * 100)) : 0 } ;};
  const statistics = useMemo<AnimeStatistics>(() => {
    let series = 0, movies = 0, specials = 0, titles = 0, totalSeconds = 0;
    const genres = new Map<string, number>();
    const rewatches: { animeId: number; title: string; count: number }[] = [];
    const activity: StatisticsActivityEntry[] = [];
    for (const [idText, item] of Object.entries(progress)) {
      const animeId = +idText, anime = known(animeId), episodeEntries = Object.entries(item.episodes), states = episodeEntries.map(([, state]) => state), completed = states.filter(isEpisodeWatched), completionCount = states.reduce((sum, state) => sum + (state.completions ?? (isEpisodeWatched(state) ? 1 : 0)), 0), rewatchCount = Math.max(0, completionCount - completed.length);
      totalSeconds += states.reduce((sum, state) => sum + (state.watchedSeconds ?? Math.min(state.position, state.duration || state.position)), 0);
      if (anime && isMovieAnime(anime)) movies += completed.length;
      else if (anime && isExtraAnime(anime)) specials += completed.length;
      else series += completed.length;
      if (completed.length && (item.totalEpisodes ? completed.length >= item.totalEpisodes : true)) titles++;
      for (const genre of anime?.genres ?? []) genres.set(genre.title, (genres.get(genre.title) ?? 0) + completed.length);
      if (rewatchCount > 0) rewatches.push({ animeId, title: anime?.title ?? `Аниме #${animeId}`, count: rewatchCount });
      for (const [episodeKey, state] of episodeEntries) {
        if (!isEpisodeWatched(state)) continue;
        const separator = episodeKey.indexOf(":"), season = Number(episodeKey.slice(0, separator)) || item.season || 1, episode = separator >= 0 ? episodeKey.slice(separator + 1) : episodeKey;
        const timestamps = state.completionHistory?.length
          ? state.completionHistory
          : Array.from({ length: Math.max(1, state.completions ?? 1) }, () => state.updatedAt);
        for (const timestamp of timestamps) activity.push({ timestamp, animeId, title: anime?.title ?? `Аниме #${animeId}`, season, episode, duration: state.duration || 0 });
      }
    }
    return {
      series,
      movies,
      specials,
      titles,
      totalSeconds,
      activity: activity.sort((left, right) => right.timestamp - left.timestamp),
      favoriteGenres: [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      mostRewatched: rewatches.sort((a, b) => b.count - a.count).slice(0, 6),
    };
  }, [progress, catalog]);
  const favoriteStats = folderStats({ id: "favorites", name: "Избранное", animeIds: favorites });
  const makeSnapshot = (name: string): ConfigSnapshot => {
    const previous = profiles.find(profile => profile.id === activeProfile)?.snapshot;
    return migrateSnapshot(
      {
        // Unknown future settings remain intact while current fields are
        // refreshed from the live React state.
        ...previous,
        version: SCHEMA_VERSION,
        name,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        favorites,
        folders,
        progress,
        tracked,
        theme,
        toolbar: read(K.toolbar, "bottom"),
        playerPrefs: { ...DEFAULT_PLAYER_PREFS, ...playerPrefs },
        historyClearedAt,
        historyEnabled,
        libraryExpanded,
        watchingExpanded,
        historyExpanded,
        watchingHidden,
      },
      name,
    );
  };
  const makeDocument = (
    nextProfiles: ConfigProfile[],
    nextActiveProfile = activeProfile,
  ): StorageDocument => {
    const document = migrateDocument({
      ...storageEnvelopeRef.current,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      activeProfile: nextActiveProfile,
      profiles: nextProfiles,
    });
    storageEnvelopeRef.current = document;
    return document;
  };
  useEffect(() => {
    if (!storageReady) return;
    setSaveStatus({ state: "saving" });
    const timer = setTimeout(async () => {
      const existingProfile = profiles.find(profile => profile.id === activeProfile);
      const name = existingProfile?.name ?? "Основной";
      const snapshot = makeSnapshot(name);
      const nextProfiles = [
        ...profiles.filter(profile => profile.id !== activeProfile),
        { ...(existingProfile ?? {}), id: activeProfile, name, snapshot },
      ];
      const document = makeDocument(nextProfiles);
      write(K.profiles, nextProfiles);
      try {
        const response = await saveStorageDocument(document);
        if (!response.ok) throw Error("Storage unavailable");
        setSaveStatus({ state: "saved", at: Date.now() });
      } catch (error) {
        console.warn("Не удалось сохранить данные на диск", error);
        setSaveStatus({ state: "error" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [storageReady, favorites, folders, progress, tracked, theme, playerPrefs, historyClearedAt, historyEnabled, libraryExpanded, watchingExpanded, historyExpanded, watchingHidden, activeProfile]);
  const exportConfig = () => { const profileName = profiles.find(p => p.id === activeProfile)?.name ?? "Основной"; const blob = new Blob([JSON.stringify(makeSnapshot(profileName), null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `AnimeSoul-${profileName.replace(/[^\p{L}\p{N}-]+/gu, "-")}.json`; a.click(); URL.revokeObjectURL(url) ;};
  const applySnapshot = (input: ConfigSnapshot, useSnapshotLayout = false) => {
    const s = migrateSnapshot(input, input.name);
    const layout = {
      library: resolveStoredBoolean(useSnapshotLayout ? undefined : read<boolean | undefined>(K.libraryExpanded, undefined), s.libraryExpanded, true),
      watching: resolveStoredBoolean(useSnapshotLayout ? undefined : read<boolean | undefined>(K.watchingExpanded, undefined), s.watchingExpanded, true),
      history: resolveStoredBoolean(useSnapshotLayout ? undefined : read<boolean | undefined>(K.historyExpanded, undefined), s.historyExpanded, true),
    };
    write(K.favorites, s.favorites);
    write(K.folders, s.folders);
    write(K.progress, s.progress);
    write(K.tracked, s.tracked);
    write(K.theme, s.theme);
    write(K.toolbar, s.toolbar);
    write(K.playerPrefs, { ...DEFAULT_PLAYER_PREFS, ...s.playerPrefs });
    write(K.historyClearedAt, s.historyClearedAt ?? 0);
    write(K.historyEnabled, s.historyEnabled ?? true);
    write(K.libraryExpanded, layout.library);
    write(K.watchingExpanded, layout.watching);
    write(K.historyExpanded, layout.history);
    setLibraryExpanded(layout.library);
    setWatchingExpanded(layout.watching);
    setHistoryExpanded(layout.history);
    write(K.watchingHidden, s.watchingHidden ?? []);
  };
  const switchProfile = async (id: string) => {
    if (id === activeProfile) return;
    const existingCurrent = profiles.find(profile => profile.id === activeProfile);
    const currentName =
      existingCurrent?.name ?? (activeProfile === "default" ? "Основной" : "Профиль");
    const savedCurrent: ConfigProfile = {
      ...(existingCurrent ?? {}),
      id: activeProfile,
      name: currentName,
      snapshot: makeSnapshot(currentName),
    };
    const updated = [
      ...profiles.filter(profile => profile.id !== activeProfile),
      savedCurrent,
    ];
    const target = updated.find(profile => profile.id === id);
    if (!target) {
      alert("Этот профиль не найден. Импортируй его заново.");
      return;
    }
    const migratedTarget = {
      ...target,
      snapshot: migrateSnapshot(target.snapshot, target.name),
    };
    const nextProfiles = updated.map(profile =>
      profile.id === id ? migratedTarget : profile,
    );
    const document = makeDocument(nextProfiles, id);
    write(K.profiles, nextProfiles);
    localStorage.setItem(K.activeProfile, id);
    applySnapshot(migratedTarget.snapshot, true);
    await saveStorageDocument(document);
    location.reload();
  };
  const importConfig = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as Partial<ConfigSnapshot>;
      const parsed = migrateSnapshot(raw, raw.name || file.name.replace(/\.json$/i, ""));
      const name = prompt(
        "Название импортированного профиля",
        parsed.name || file.name.replace(/\.json$/i, ""),
      )?.trim();
      if (!name) return;
      const existingCurrent = profiles.find(profile => profile.id === activeProfile);
      const currentName =
        existingCurrent?.name ?? (activeProfile === "default" ? "Основной" : "Профиль");
      const currentProfile: ConfigProfile = {
        ...(existingCurrent ?? {}),
        id: activeProfile,
        name: currentName,
        snapshot: makeSnapshot(currentName),
      };
      const profile: ConfigProfile = {
        id: crypto.randomUUID(),
        name,
        snapshot: migrateSnapshot({ ...parsed, name }, name),
      };
      const next = [
        ...profiles.filter(existing => existing.id !== activeProfile),
        currentProfile,
        profile,
      ];
      setProfiles(next);
      write(K.profiles, next);
      const shouldSwitch = confirm(
        `Профиль «${name}» загружен. Переключиться на него сейчас?`,
      );
      const nextActive = shouldSwitch ? profile.id : activeProfile;
      await saveStorageDocument(makeDocument(next, nextActive));
      if (shouldSwitch) {
        localStorage.setItem(K.activeProfile, profile.id);
        applySnapshot(profile.snapshot, true);
        location.reload();
      }
    } catch {
      alert("Не удалось загрузить конфигурацию AnimeSoul");
    }
  };
  const changeHistoryEnabled = (enabled: boolean) => { const now = Date.now(); setHistoryEnabled(enabled); write(K.historyEnabled, enabled); setHistoryClearedAt(now); write(K.historyClearedAt, now) ;};
  const openAnime = (anime: Anime, resume = false) => { setResumeRequested(resume); setActive(anime) ;};
  const openLibrary = () => { setActive(null); setResumeRequested(false); setNewEpisodeRequested(false); setView("stats"); window.scrollTo({ top: 0, behavior: "smooth" }) ;};
  if (active) { const activeTracker = tracked.find(t => t.animeId === active.anime_id || t.animeIds?.includes(active.anime_id)), goCatalog = () => { setActive(null); setResumeRequested(false); setNewEpisodeRequested(false); setView("catalog"); setTimeout(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }), 0) ;}, searchCatalog = () => { setActive(null); setResumeRequested(false); setNewEpisodeRequested(false); setView("catalog"); void load(0, false, query); setTimeout(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }), 0) ;}, watchHeader = <Header query={query} setQuery={setQuery} onSearch={searchCatalog} onCatalog={goCatalog} onLibrary={openLibrary} theme={theme} setTheme={setTheme} playerPrefs={playerPrefs} setPlayerPrefs={setPlayerPrefs} historyEnabled={historyEnabled} onHistoryEnabledChange={changeHistoryEnabled} suggestions={franchises.filter(a => query.length > 1 && a.title.toLowerCase().includes(query.toLowerCase())).slice(0, 6)} onSuggestion={a => { setQuery(a.title); setActive(a); setResumeRequested(false); setNewEpisodeRequested(false) ;}} profiles={profiles} activeProfile={activeProfile} onSwitchProfile={switchProfile} onExport={exportConfig} onImport={importConfig} />; return <Watch header={watchHeader} anime={active} resumeRequested={resumeRequested} newEpisodeRequested={newEpisodeRequested} favorite={favorites.includes(active.anime_id)} onFavorite={() => toggleFavorite(active.anime_id)} onBack={goCatalog} onLibrary={openLibrary} onGenre={selectedGenre => { setGenre(selectedGenre); setQuery(""); setActive(null); setResumeRequested(false); setNewEpisodeRequested(false); setView("catalog"); window.scrollTo({ top: 0, behavior: "smooth" }) ;}} saved={progress[active.anime_id]}
      onProgress={(v, originEpisodeKey, changedEpisodeKey) => { const keys = Array.isArray(changedEpisodeKey) ? changedEpisodeKey : [changedEpisodeKey ?? `${v.season ?? 1}:${v.episode}`], originKeys = Array.isArray(originEpisodeKey) ? originEpisodeKey : originEpisodeKey ? [originEpisodeKey] : []; setProgress(current => { const newlyWatched = keys.some(key => !isEpisodeWatched(current[active.anime_id]?.episodes[key]) && isEpisodeWatched(v.episodes[key])), next = { ...current, [active.anime_id]: v }; write(K.progress, next); if (activeTracker && originKeys.length && newlyWatched) setTracked(currentTracked => { const nextTracked = currentTracked.map(t => t.animeId === activeTracker.animeId ? originKeys.reduce((updated, key) => acknowledgeTrackedEpisode(updated, key), t) : t); write(K.tracked, nextTracked); return nextTracked ;}); return next ;}) ;}}
      onPlayerPrefsChange={setPlayerPrefs}
      onFolders={() => setFolderPicker(active)} tracker={activeTracker} onTrack={(count, dubs, animeIds, title, knownKeys) => saveTracked([...tracked.filter(t => t.animeId !== activeTracker?.animeId), { animeId: animeIds[0] ?? active.anime_id, animeIds, title, knownEpisodes: count, knownEpisodeKeys: knownKeys, pendingEpisodeKeys: [], newEpisodes: 0, dubs, lastCheckedAt: Date.now() }])} onUntrack={() => saveTracked(tracked.filter(t => t.animeId !== activeTracker?.animeId))} folderPicker={folderPicker} folders={folders} toggleFolder={toggleFolder} createFolder={createFolder} closePicker={() => setFolderPicker(null)} /> ;}
  return <main className="app"><Header query={query} setQuery={setQuery} onSearch={() => { setView("catalog"); void load(0, false, query); window.scrollTo({ top: 0, behavior: "smooth" }) ;}} onCatalog={() => { setView("catalog"); window.scrollTo({ top: 0, behavior: "smooth" }) ;}} onLibrary={openLibrary} theme={theme} setTheme={setTheme} playerPrefs={playerPrefs} setPlayerPrefs={setPlayerPrefs} historyEnabled={historyEnabled} onHistoryEnabledChange={changeHistoryEnabled} suggestions={franchises.filter(a => query.length > 1 && a.title.toLowerCase().includes(query.toLowerCase())).slice(0, 6)} onSuggestion={a => { setQuery(a.title); setActive(a) ;}} profiles={profiles} activeProfile={activeProfile} onSwitchProfile={switchProfile} onExport={exportConfig} onImport={importConfig} />
    {view === "home" && <>{partyPresence.session && partyHostPlayback && <section className="party-host-now"><span><i /><small>СОВМЕСТНЫЙ ПРОСМОТР · {partyPresence.party?.roomMode === "shared" ? "ОБЩЕЕ УПРАВЛЕНИЕ" : "УПРАВЛЯЕТ ХОСТ"}</small><b>{partyHost?.name ?? "Хост"} смотрит: {partyHostAnime?.title ?? `аниме #${partyHostPlayback.animeId}`}</b><em>Сезон {partyHostPlayback.season} · серия {partyHostPlayback.episode} · {formatTime(partyHostPlayback.position)}</em></span>{partyHostAnime && <button className="primary" onClick={() => openAnime(partyHostAnime, false)}>Открыть просмотр</button>}</section>}<section className={`hero dashboard-hero ${lastAnime && lastState && playerPrefs.homeEpisodePreview ? "with-episode-preview" : ""}`}><div className="hero-content"><span className="eyebrow">{lastAnime && lastState ? "ПРОДОЛЖИТЬ ПРОСМОТР" : "ВЫБРАТЬ ЧТО ПОСМОТРЕТЬ"}</span>{lastAnime && lastState ? <><h1>{lastAnime.title}</h1><p>{lastState.seasonLabel ?? `Сезон ${lastPoint?.season ?? lastState.season ?? 1}`} · серия {lastDisplayEpisode} · остановились на {formatTime(lastPoint?.state?.position ?? 0)}</p>{playerPrefs.homeEpisodePreview ? <EpisodeSlideshow key={playerPrefs.homePreviewMode} className="hero-episode-preview" images={playerPrefs.homePreviewMode === "screenshots" ? episodePreviewImages(heroPreviewAnime ?? lastAnime, lastDisplayEpisode) : []} fallback={heroPreviewAnime?.poster?.fullsize ?? heroPreviewAnime?.poster?.big ?? lastAnime.poster?.fullsize ?? lastAnime.poster?.big} allowLowQuality={playerPrefs.homePreviewMode === "screenshots"} label={`${lastState.seasonLabel ?? `Сезон ${lastPoint?.season ?? lastState.season ?? 1}`} · Серия ${lastDisplayEpisode}`} sublabel={`Продолжить с ${formatTime(lastPoint?.state?.position ?? 0)}`} iframeUrl={playerPrefs.homePreviewMode === "screenshots" ? heroPreviewVideo?.iframe_url : undefined} duration={heroPreviewVideo?.duration ?? lastPoint?.state?.duration ?? 1440} onClick={() => openAnime(lastAnime, true)} /> : <button className="primary" onClick={() => openAnime(lastAnime, true)}>▶ Продолжить просмотр</button>}</> : <><h1>Твоя коллекция.<br /><i>Твои правила.</i></h1><p>Сейчас нет незавершённого просмотра — выбери новое аниме в каталоге.</p><button className="primary" onClick={() => { setView("catalog"); window.scrollTo({ top: 0, behavior: "smooth" }) ;}}>⌕ Выбрать что посмотреть</button></>}<details className="compact-options hero-options"><summary>⚙ Настройки продолжения</summary><div><Toggle label="Автоматически запускать продолжение" value={playerPrefs.autoPlayResume} onChange={v => { const next = { ...playerPrefs, autoPlayResume: v }; setPlayerPrefs(next); write(K.playerPrefs, next) ;}} /><Toggle label="Предпросмотр серии на главной" value={playerPrefs.homeEpisodePreview} onChange={v => { const next = { ...playerPrefs, homeEpisodePreview: v }; setPlayerPrefs(next); write(K.playerPrefs, next) ;}} /><div className={`preview-mode-field ${playerPrefs.homeEpisodePreview ? "enabled" : "disabled"}`}><span>Изображение предпросмотра</span><div className="preview-mode-switch" role="group" aria-label="Изображение предпросмотра"><button type="button" disabled={!playerPrefs.homeEpisodePreview} className={playerPrefs.homePreviewMode === "poster" ? "active" : ""} onClick={() => { const next = { ...playerPrefs, homePreviewMode: "poster" as const }; setPlayerPrefs(next); write(K.playerPrefs, next) ;}}>HD-картинка</button><button type="button" disabled={!playerPrefs.homeEpisodePreview} className={playerPrefs.homePreviewMode === "screenshots" ? "active" : ""} onClick={() => { const next = { ...playerPrefs, homePreviewMode: "screenshots" as const }; setPlayerPrefs(next); write(K.playerPrefs, next) ;}}>Кадры серии</button></div>{playerPrefs.homeEpisodePreview && playerPrefs.homePreviewMode === "screenshots" && <small>Загружается качественный беззвучный видеопредпросмотр серии.</small>}</div></div></details></div>
      <div className="hero-widgets"><div className="hero-box"><h3>♥ Избранное <span>{favorites.length}</span></h3><div className="mini-list hero-scroll">{favorites.map(id => { const anime = known(id); return <div className="hero-mini-row" key={id}><button className="hero-mini-main" onClick={() => anime && setActive(anime)}><span>{anime?.title ?? `Аниме #${id}`}<ReleaseMark anime={anime} status={cardMeta[id]?.status} /></span><small>{animeProgress(progress[id])}%</small></button><button className="hero-mini-delete" title="Удалить из избранного" aria-label={`Удалить ${anime?.title ?? `аниме #${id}`} из избранного`} onClick={() => saveFav(favorites.filter(item => item !== id))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z" /></svg></button></div> ;})}</div></div>
        <div className="hero-box"><h3>Папки <span className="hero-folder-actions">{lastDeletedFolder && <button title={`Восстановить папку «${lastDeletedFolder.folder.name}»`} onClick={restoreLastFolder}>↶</button>}<button title="Новая папка" onClick={createFolder}>＋</button></span></h3><div className="hero-scroll">{folders.map(f => { const s = folderStats(f); return <div className="hero-mini-row hero-folder-row" key={f.id}><button className="folder-progress" onClick={() => setOpenedFolder(f)}><span>{f.name}<small>{s.watched}/{s.total} серий</small></span><i><b style={{ width: `${s.percent}%` }} /></i><em>{s.percent}%</em></button><button className="hero-mini-delete" title={`Удалить папку «${f.name}»`} aria-label={`Удалить папку ${f.name}`} onClick={() => deleteFolder(f)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z" /></svg></button></div> ;})}</div></div>
        <div className="hero-box alerts"><h3>Отслеживаю <span>{tracked.length}</span></h3><div className="hero-scroll hero-tracking-list">{tracked.map(t => { const anime = known(t.animeId); return <article className="hero-track-card" key={t.animeId}><button className="hero-track-main" onClick={() => { if (anime) { setNewEpisodeRequested(false); setActive(anime) ;} }}><b>{t.title}</b><ReleaseMark anime={anime} status={cardMeta[t.animeId]?.status} /><small>{t.dubs?.length ? `Озвучки: ${t.dubs.join(", ")}` : "Все озвучки"}</small><span>{t.knownEpisodes} известных серий</span></button><div className="hero-track-actions">{t.newEpisodes > 0 && <button className="watch-new-button" onClick={() => { if (anime) { setResumeRequested(false); setNewEpisodeRequested(true); setActive(anime) ;} }}>▶ Смотреть новую серию</button>}<button className="untrack-button" onClick={() => saveTracked(tracked.filter(x => x.animeId !== t.animeId))}>Отписаться</button><em className={t.newEpisodes > 0 ? "release-status new" : "release-status quiet"}><i />{t.newEpisodes > 0 ? `Новая серия · +${t.newEpisodes}` : "Новых серий нет"}</em></div></article> ;})}{!tracked.length && <small>Подписок пока нет</small>}</div></div></div>
    </section>
      <section className="library" id="my-library"><div className="section-collapse-control"><button className={`collapse-toggle ${libraryExpanded ? "expanded" : ""}`} aria-expanded={libraryExpanded} onClick={() => { const next = !libraryExpanded; write(K.libraryExpanded, next); setLibraryExpanded(next) ;}}><i>⌄</i><span>Папки и избранное</span></button></div>
        <div className={`collapse-shell ${libraryExpanded ? "expanded" : ""}`}><div className="collapse-inner"><div className="section-inline-actions">{lastDeletedFolder && <button className="outline restore-folder" onClick={restoreLastFolder}>↶ Восстановить «{lastDeletedFolder.folder.name}»</button>}<button className="outline" onClick={createFolder}>＋ Новая папка</button></div><div className="collection-grid">
          <div className="collection-card favorites-card"><h3>♥ Избранное</h3><b>{favorites.length} тайтлов · {favoriteStats.watched} из {favoriteStats.total} серий</b><div className="wide-progress"><i style={{ width: `${favoriteStats.percent}%` }} /></div><div>{favorites.map(id => { const anime = known(id); return <div className="collection-row" draggable key={id} onDragStart={e => e.dataTransfer.setData("text/plain", String(id))} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData("text/plain")); saveFav(reorder(favorites, from, id)) ;}}><i className="drag">⠿</i><button className="collection-title" onClick={() => anime && setActive(anime)}><b>{anime?.title ?? `Аниме #${id}`}<ReleaseMark anime={anime} status={cardMeta[id]?.status} /></b><span>{animeProgress(progress[id])}%</span></button><button className="collection-remove" title="Удалить из избранного" onClick={() => saveFav(favorites.filter(item => item !== id))}>×</button></div> ;})}</div></div>
          {folders.map(f => { const s = folderStats(f); return <div className="collection-card" key={f.id} role="button" tabIndex={0} onClick={() => setOpenedFolder(f)}><h3>{f.name}</h3><b>{f.animeIds.length} тайтлов · {s.watched} из {s.total} серий</b><div className="wide-progress"><i style={{ width: `${s.percent}%` }} /></div><div>{f.animeIds.map(id => { const anime = known(id); return <div className="collection-row compact" key={id}><button className="collection-title">{anime?.title ?? `Аниме #${id}`}<ReleaseMark anime={anime} status={cardMeta[id]?.status} /></button><button className="collection-remove" title="Удалить из папки" onClick={event => { event.stopPropagation(); saveFolders(folders.map(folder => folder.id === f.id ? { ...folder, animeIds: folder.animeIds.filter(item => item !== id) } : folder)) ;}}>×</button></div> ;})}</div></div> ;})}
        </div></div></div>
        {watchingItems.length > 0 && <section className="watching-section"><div className="section-collapse-control"><button className={`collapse-toggle ${watchingExpanded ? "expanded" : ""}`} aria-expanded={watchingExpanded} onClick={() => { const next = !watchingExpanded; write(K.watchingExpanded, next); setWatchingExpanded(next) ;}}><i>⌄</i><span>Смотрю сейчас</span></button></div><div className={`collapse-shell ${watchingExpanded ? "expanded" : ""}`}><div className="collapse-inner"><div className="section-inline-actions"><span>{watchingItems.length} тайтлов</span></div><div className="watching-list">{watchingItems.map(entry => { const anime = known(entry.animeId), whole = watchTimeProgress(entry.item); return <article key={entry.animeId}>{anime?.poster?.big && <img src={anime.poster.big} alt="" />}<button className="watching-main" onClick={() => anime && openAnime(anime, true)}><b>{anime?.title ?? `Аниме #${entry.animeId}`}</b><ReleaseMark anime={anime} status={cardMeta[entry.animeId]?.status} /><small>Сезон {entry.season} · серия {entry.episode} · {formatTime(entry.state.position)}</small><div className="wide-progress"><i style={{ width: `${whole}%` }} /></div><span>{whole}% просмотрено</span></button><div className="watching-actions">{anime && <button className="primary" onClick={() => openAnime(anime, true)}>▶ Продолжить</button>}<button className="watching-remove" title="Убрать из списка «Смотрю сейчас»" onClick={() => { const next = [...new Set([...watchingHidden, entry.animeId])]; setWatchingHidden(next); write(K.watchingHidden, next) ;}}>×</button></div></article> ;})}</div></div></div></section>}
        <section className="history-collapsible"><div className="section-collapse-control history-collapse-control"><button className={`collapse-toggle ${historyExpanded ? "expanded" : ""}`} aria-expanded={historyExpanded} onClick={() => { const next = !historyExpanded; write(K.historyExpanded, next); setHistoryExpanded(next) ;}}><i>⌄</i><span>История просмотра</span><small>{historyEnabled ? "Просмотры сохраняются" : "История выключена"}</small></button><div className="history-enable-control" onClick={event => event.stopPropagation()}><Toggle label="Сохранять историю" value={historyEnabled} onChange={enabled => { const now = Date.now(); setHistoryEnabled(enabled); write(K.historyEnabled, enabled); setHistoryClearedAt(now); write(K.historyClearedAt, now) ;}} /></div></div><div className={`collapse-shell ${historyExpanded ? "expanded" : ""}`}><div className="collapse-inner"><div className="history-section"><div className="history-head-actions"><span>{historyItems.length} записей</span><button className="outline danger" disabled={!historyItems.length} onClick={() => { if (confirm("Очистить историю просмотра? Прогресс серий сохранится.")) { const now = Date.now(); setHistoryClearedAt(now); write(K.historyClearedAt, now) ;} }}>Очистить историю</button></div><div className="history-list">{historyItems.map(item => { const anime = known(item.animeId); return <article key={`${item.animeId}:${item.season}:${item.episode}`}><button onClick={() => { if (!anime) return; const current = progress[item.animeId]; saveProgress({ ...progress, [item.animeId]: { ...current, season: item.season, episode: item.episode } }); openAnime(anime, true) ;}}>{anime?.poster?.big && <img src={anime.poster.big} alt="" />}<span><b>{anime?.title ?? `Аниме #${item.animeId}`}</b><ReleaseMark anime={anime} status={cardMeta[item.animeId]?.status} /><small>Сезон {item.season} · серия {item.episode} · {formatTime(item.state.position)}</small></span><time>{new Date(item.state.updatedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><em>▶ Продолжить</em></button></article> ;})}{!historyItems.length && <div className="empty history-empty">{historyEnabled ? "История очищена. Новые просмотры появятся здесь автоматически." : "Сохранение истории выключено. Прогресс просмотра продолжает сохраняться."}</div>}</div></div></div></div></section>
        <FAQBlock />
      </section></>}
    {view === "stats" && <StatisticsPage statistics={statistics} onHome={() => { setView("home"); window.scrollTo({ top: 0, behavior: "smooth" }) ;}} />}
    {view === "catalog" && <section className="library catalog-page" id="catalog"><div className="section-head"><div><span className="eyebrow">КАТАЛОГ YUMMYANIME</span><h2>{query ? `Результаты: ${query}` : "Все аниме"}</h2></div><button className="outline" onClick={() => { setView("home"); window.scrollTo({ top: 0, behavior: "smooth" }) ;}}>← На главную</button></div>
      <div className="filter-panel"><select value={sort} onChange={e => setSort(e.target.value)}><option value="rating-desc">Рейтинг: высокий</option><option value="rating-asc">Рейтинг: низкий</option><option value="year-desc">Сначала новые</option><option value="year-asc">Сначала старые</option><option value="views">По популярности</option></select><select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}><option value="all">Франшизы и тайтлы</option><option value="franchise">Только франшизы</option><option value="title">Только отдельные тайтлы</option></select><select value={formatFilter} onChange={e => setFormatFilter(e.target.value)}><option value="all">Фильмы и сериалы</option><option value="series">Только сериалы</option><option value="movie">Только фильмы</option></select><label>Год от <input type="number" value={yearFrom} onChange={e => setYearFrom(e.target.value)} placeholder="1990" /></label><label>до <input type="number" value={yearTo} onChange={e => setYearTo(e.target.value)} placeholder="2026" /></label><button onClick={() => { setYearFrom(""); setYearTo(""); setSort("rating-desc"); setGenre("Все"); setGroupFilter("all"); setFormatFilter("all") ;}}>Сбросить</button><button className="random-trigger" onClick={() => setRandomOpen(v => !v)}>⚄ Рандом</button></div>
      {randomOpen && <div className="random-panel"><div><label>Жанр<select value={randomGenre} onChange={e => setRandomGenre(e.target.value)}>{genres.map(g => <option key={g}>{g}</option>)}</select></label><label>Год от<input type="number" value={randomYearFrom} onChange={e => setRandomYearFrom(e.target.value)} placeholder="1990" /></label><label>до<input type="number" value={randomYearTo} onChange={e => setRandomYearTo(e.target.value)} placeholder="2026" /></label><label>Рейтинг от<select value={randomRating} onChange={e => setRandomRating(e.target.value)}><option value="0">Любой</option><option value="6">6.0</option><option value="7">7.0</option><option value="8">8.0</option><option value="9">9.0</option></select></label></div><button className="primary" disabled={!randomCandidates.length} onClick={() => { const picked = randomCandidates[Math.floor(Math.random() * randomCandidates.length)]; if (picked) openAnime(picked) ;}}>⚄ Выбрать случайное аниме</button><small>{randomCandidates.length ? `${randomCandidates.length} подходящих франшиз` : "Нет аниме с такими фильтрами"}</small></div>}
      <div className="genre-row">{genres.map(g => <button key={g} className={genre === g ? "selected" : ""} onClick={() => setGenre(g)}>{g}</button>)}</div>{error && <div className="empty">{error}</div>}<div className="cards">{visible.map(a => <AnimeCard key={a.anime_id} anime={a} meta={cardMeta[a.anime_id]} onOpen={anime => openAnime(anime)} favorite={favorites.includes(a.anime_id)} onFavorite={() => toggleFavorite(a.anime_id)} onFolders={() => setFolderPicker(a)} progress={progress[a.anime_id]} />)}</div>{!query && <button type="button" className="load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? "Загружаем новые аниме…" : "Показать ещё"}</button>}</section>}
    <footer><Brand /><span className="api-thanks">Огромная благодарность разработчикам YummyAnime за предоставленный API — только благодаря им был создан AnimeSoul.</span><span>Прогресс и настройки сохраняются на этом ПК</span><span className="app-version">Версия {APP_VERSION}</span></footer>
    {collectionOverview && <CollectionOverview
      kind={collectionOverview}
      favorites={favorites}
      folders={folders}
      tracked={tracked}
      progress={progress}
      cardMeta={cardMeta}
      known={known}
      onClose={() => setCollectionOverview(null)}
      onOpenAnime={(anime, resume) => {
        setCollectionOverview(null);
        openAnime(anime, resume);
      }}
      onOpenFolder={folder => {
        setCollectionOverview(null);
        setOpenedFolder(folder);
      }}
      onRemoveFavorite={id => saveFav(favorites.filter(item => item !== id))}
      onDeleteFolder={deleteFolder}
      onWatchNew={anime => {
        setCollectionOverview(null);
        setResumeRequested(false);
        setNewEpisodeRequested(true);
        setActive(anime);
      }}
      onUntrack={tracker => saveTracked(tracked.filter(item => item.animeId !== tracker.animeId))}
    />}
    {folderPicker && <FolderPicker anime={folderPicker} folders={folders} onToggle={toggleFolder} onCreate={createFolder} onClose={() => setFolderPicker(null)} />}
    {openedFolder && <FolderView folder={folders.find(f => f.id === openedFolder.id) ?? openedFolder} known={known} progress={progress} cardMeta={cardMeta} onOpen={(a, resume) => { setOpenedFolder(null); openAnime(a, resume) ;}} onNote={(id, note) => saveFolders(folders.map(f => f.id === openedFolder.id ? { ...f, notes: { ...(f.notes ?? {}), [id]: note } } : f))} onReorder={(from, to) => saveFolders(folders.map(f => f.id === openedFolder.id ? { ...f, animeIds: reorder(f.animeIds, from, to) } : f))} onDelete={() => { if (confirm(`Удалить папку «${openedFolder.name}»?`)) deleteFolder(openedFolder) ;}} onClose={() => setOpenedFolder(null)} />}
    {libraryOpen && <div className="toast">Библиотека открыта ниже</div>}</main>;
}

function FAQBlock() {
return <details className="catalog-guide"><summary><span><b>Вопросы и ответы · возможности AnimeSoul</b><small>Как устроен сайт, просмотр, библиотека, перенос сохранений и настройки</small></span><i>⌄</i></summary><div className="catalog-guide-content">
    <article><b>◆ Франшизы и отдельные тайтлы</b><p>Связанные сезоны, фильмы, OVA и спешлы собираются на одной странице в порядке просмотра API. Самостоятельные произведения остаются отдельными тайтлами.</p></article>
    <article><b>Озвучки и плеер</b><p>Можно выбирать доступную озвучку и источник, автоматически переключать серии, запускать продолжение и пропускать опенинг или эндинг. Видео загружается из внешнего API и не хранится на компьютере.</p></article>
    <article><b>Прогресс и библиотека</b><p>Сохраняются сезон, серия, озвучка, точное место остановки, избранное, папки, заметки, порядок тайтлов, отслеживания, история, темы и настройки.</p></article>
    <article><b>Отслеживание новых серий</b><p>Отслеживание работает для всей франшизы и выбранных озвучек. Новые серии выделяются цветом; их можно сразу запустить кнопкой в блоке отслеживания.</p></article>
    <article><b>Поиск, фильтры и рандом</b><p>Каталог поддерживает подсказки, сортировку по рейтингу, году и популярности, фильтры формата и типа записи, а также случайный выбор по заданным условиям.</p></article>
    <article><b>Перенос через сайт</b><p>На старом устройстве или в старой версии нажмите <code>Выгрузить конфиг</code> в верхнем меню. В новой версии нажмите <code>Загрузить конфиг</code>, выберите скачанный JSON-файл и переключитесь на импортированный профиль. Такой способ подходит и для переноса между компьютерами.</p></article>
    <article><b>Перенос полного сохранения между двумя версиями</b><p>Закройте обе версии. Файлы находятся в <code>legacy-old-stack/data/animesoul-storage.json</code> и <code>app/data/animesoul-storage.json</code>. Безопаснее использовать инструмент из папки <code>app</code>: команда <code>python -m tools.transfer_saves to-main</code> переносит данные в основную версию, а <code>to-legacy</code> — обратно. Перед заменой автоматически создаётся резервная копия.</p></article>
    <article><b>Обновление без потери данных</b><p>Перед обновлением рекомендуется сохранить экспортированный конфиг или копию <code>data/animesoul-storage.json</code>. Новые версии автоматически дополняют старые сохранения недостающими настройками.</p></article>
    <article><b>Приватность</b><p>Аккаунт не обязателен. Основная версия хранит данные локально в <code>app/data/animesoul-storage.json</code>; браузерное хранилище используется как резервное зеркало. Browser и Desktop используют один файл.</p></article>
    <article className="faq-contact"><b>Нашли ошибку или есть пожелание?</b><p>AnimeSoul создаётся для комфортного просмотра аниме. Отправляйте ошибки и идеи для улучшения в Discord: <code>quidden</code>.</p></article>
  </div></details>
;}


type StatisticsActivityEntry = {
  timestamp: number;
  animeId: number;
  title: string;
  season: number;
  episode: string;
  duration: number;
};

type AnimeStatistics = {
  series: number;
  movies: number;
  specials: number;
  titles: number;
  totalSeconds: number;
  activity: StatisticsActivityEntry[];
  favoriteGenres: [string, number][];
  mostRewatched: { animeId: number; title: string; count: number }[];
};

type ActivityDay = {
  key: string;
  date: Date;
  entries: StatisticsActivityEntry[];
};

const localDayKey = (input: number | Date) => {
  const date = input instanceof Date ? input : new Date(input);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

function StatisticsPage({ statistics, onHome }: { statistics: AnimeStatistics; onHome: () => void }) {
  const maxGenre = statistics.favoriteGenres[0]?.[1] ?? 1;
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const eventYears = statistics.activity.map(entry => new Date(entry.timestamp).getFullYear());
    const earliest = Math.min(currentYear, ...eventYears);
    return Array.from({ length: currentYear - earliest + 1 }, (_, index) => currentYear - index);
  }, [statistics.activity, currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const yearActivity = useMemo(
    () => statistics.activity.filter(entry => new Date(entry.timestamp).getFullYear() === selectedYear),
    [statistics.activity, selectedYear],
  );
  const calendar = useMemo(() => {
    const entriesByDay = new Map<string, StatisticsActivityEntry[]>();
    for (const entry of yearActivity) {
      const key = localDayKey(entry.timestamp);
      entriesByDay.set(key, [...(entriesByDay.get(key) ?? []), entry]);
    }
    const start = new Date(selectedYear, 0, 1);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(selectedYear, 11, 31);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const days: ActivityDay[] = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor), key = localDayKey(date);
      days.push({ key, date, entries: entriesByDay.get(key) ?? [] });
    }
    return days;
  }, [yearActivity, selectedYear]);
  const weekCount = Math.ceil(calendar.length / 7);
  const monthMarkers = useMemo(() => {
    const calendarStart = calendar[0]?.date;
    if (!calendarStart) return [];
    return Array.from({ length: 12 }, (_, month) => {
      const date = new Date(selectedYear, month, 1);
      const daysFromStart = Math.round((date.getTime() - calendarStart.getTime()) / 86_400_000);
      return {
        month,
        label: date.toLocaleDateString("ru-RU", { month: "short" }).replace(".", ""),
        column: Math.floor(daysFromStart / 7) + 1,
      };
    });
  }, [calendar, selectedYear]);
  const busiestDay = useMemo(
    () => calendar.reduce<ActivityDay | null>(
      (best, day) => !best || day.entries.length > best.entries.length ? day : best,
      null,
    ),
    [calendar],
  );
  const [hoveredDayKey, setHoveredDayKey] = useState("");
  useEffect(() => setHoveredDayKey(""), [selectedYear]);
  const selectedDay = calendar.find(day => day.key === hoveredDayKey)
    ?? busiestDay
    ?? calendar.at(-1);
  const activeDays = new Set(statistics.activity.map(entry => localDayKey(entry.timestamp)));
  let currentStreak = 0;
  for (const cursor = new Date(); activeDays.has(localDayKey(cursor)); cursor.setDate(cursor.getDate() - 1)) currentStreak++;
  const monthly = useMemo(() => {
    const current = new Date(), result: { key: string; label: string; count: number; seconds: number }[] = [];
    for (let index = 11; index >= 0; index--) {
      const date = new Date(current.getFullYear(), current.getMonth() - index, 1);
      result.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: date.toLocaleDateString("ru-RU", { month: "short" }).replace(".", ""),
        count: 0,
        seconds: 0,
      });
    }
    const byKey = new Map(result.map(item => [item.key, item]));
    for (const entry of statistics.activity) {
      const date = new Date(entry.timestamp), item = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (item) {
        item.count++;
        item.seconds += entry.duration;
      }
    }
    return result;
  }, [statistics.activity]);
  const weekdays = useMemo(() => {
    const result = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map(label => ({ label, count: 0 }));
    for (const entry of statistics.activity) result[new Date(entry.timestamp).getDay()].count++;
    return result;
  }, [statistics.activity]);
  const maxMonth = Math.max(1, ...monthly.map(item => item.count));
  const maxWeekday = Math.max(1, ...weekdays.map(item => item.count));
  const maxActivity = Math.max(1, ...calendar.map(day => day.entries.length));
  const activityLevel = (count: number) => count
    ? Math.min(4, Math.max(1, Math.ceil(count / maxActivity * 4)))
    : 0;
  const watchedTotal = statistics.series + statistics.movies + statistics.specials;

  return <section className="library statistics-page">
    <div className="section-head">
      <div><span className="eyebrow">ТВОЙ ПРОСМОТР</span><h2>Статистика</h2></div>
      <button className="outline" onClick={onHome}>← На главную</button>
    </div>
    <div className="stats-grid">
      <article><small>Время просмотра</small><b>{formatLongDuration(statistics.totalSeconds)}</b></article>
      <article><small>Обычных серий</small><b>{statistics.series}</b></article>
      <article><small>Фильмов</small><b>{statistics.movies}</b></article>
      <article><small>OVA / ONA / спешлов</small><b>{statistics.specials}</b></article>
      <article><small>Завершено тайтлов</small><b>{statistics.titles}</b></article>
      <article><small>Всего видео</small><b>{watchedTotal}</b></article>
      <article><small>Активных дней</small><b>{activeDays.size}</b></article>
      <article><small>Текущая серия дней</small><b>{currentStreak}</b></article>
    </div>

    <section className="statistics-panel activity-panel">
      <div className="activity-heading">
        <div><h3>Активность просмотра</h3><p>Как на GitHub: чем ярче ячейка, тем больше серий завершено в этот день</p></div>
        <div className="activity-year-switcher">
          <button type="button" aria-label="Предыдущий год" disabled={!availableYears.includes(selectedYear - 1)} onClick={() => setSelectedYear(year => year - 1)}>‹</button>
          <select value={selectedYear} aria-label="Год активности" onChange={event => setSelectedYear(Number(event.target.value))}>
            {availableYears.map(year => <option value={year} key={year}>{year}</option>)}
          </select>
          <button type="button" aria-label="Следующий год" disabled={!availableYears.includes(selectedYear + 1)} onClick={() => setSelectedYear(year => year + 1)}>›</button>
          <b>{yearActivity.length} завершений</b>
        </div>
      </div>
      <div className="activity-day-detail" aria-live="polite">
        <div>
          <b>{selectedDay?.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</b>
          <span>{selectedDay?.entries.length
            ? `${selectedDay.entries.length} ${selectedDay.entries.length === 1 ? "просмотр" : "просмотра"}`
            : "Просмотров не было"}</span>
        </div>
        <div className={`activity-day-list ${selectedDay?.entries.length ? "" : "empty"}`}>
          {selectedDay?.entries.map((entry, index) => <article key={`${entry.timestamp}:${entry.animeId}:${entry.season}:${entry.episode}:${index}`}>
            <span><b>{entry.title}</b><small>Сезон {entry.season} · серия {entry.episode}</small></span>
            <em>{entry.duration ? formatDuration(entry.duration) : "длительность не указана"}</em>
          </article>)}
          {!selectedDay?.entries.length && <span className="activity-no-entries">Выбери заполненную ячейку, чтобы увидеть серии</span>}
        </div>
      </div>
      <div className="activity-calendar-viewport">
        <div className="activity-calendar-canvas">
          <div className="activity-months" style={{ gridTemplateColumns: `repeat(${weekCount}, 12px)` }}>
            {monthMarkers.map(month => <span key={month.month} style={{ gridColumn: month.column }}>{month.label}</span>)}
          </div>
          <div className="activity-calendar-body">
            <div className="activity-weekdays"><span>Пн</span><span>Ср</span><span>Пт</span></div>
            <div className="activity-grid" role="grid" aria-label={`Календарь просмотров за ${selectedYear} год`}>
              {calendar.map(day => <button
                type="button"
                role="gridcell"
                key={day.key}
                className={`activity-cell level-${activityLevel(day.entries.length)}${selectedDay?.key === day.key ? " selected" : ""}${day.date.getFullYear() !== selectedYear ? " outside-year" : ""}`}
                aria-label={`${day.date.toLocaleDateString("ru-RU")}: ${day.entries.length} просмотров`}
                title={`${day.date.toLocaleDateString("ru-RU")}: ${day.entries.length} просмотров`}
                onMouseEnter={() => setHoveredDayKey(day.key)}
                onFocus={() => setHoveredDayKey(day.key)}
              />)}
            </div>
          </div>
        </div>
      </div>
      <div className="activity-legend"><span>Меньше</span>{[0, 1, 2, 3, 4].map(level => <i className={`level-${level}`} key={level} />)}<span>Больше</span></div>
    </section>

    <div className="statistics-trends">
      <section className="statistics-panel">
        <h3>Последние 12 месяцев</h3>
        <p>Количество завершённых серий, фильмов и спецвыпусков</p>
        <div className="month-chart">{monthly.map(item => <div key={item.key} title={`${item.count} просмотров · ${formatLongDuration(item.seconds)}`}>
          <span><i style={{ height: `${item.count / maxMonth * 100}%` }} /></span>
          <small>{item.label}</small>
        </div>)}</div>
      </section>
      <section className="statistics-panel">
        <h3>По дням недели</h3>
        <p>Когда ты чаще всего заканчиваешь просмотр</p>
        <div className="weekday-chart">{weekdays.map(item => <div key={item.label}>
          <span>{item.label}<b>{item.count}</b></span>
          <i><em style={{ width: `${item.count / maxWeekday * 100}%` }} /></i>
        </div>)}</div>
      </section>
    </div>

    <div className="statistics-columns">
      <section className="statistics-panel">
        <h3>Любимые жанры</h3><p>По количеству просмотренных серий и фильмов</p>
        <div className="genre-stats">{statistics.favoriteGenres.map(([genre, count]) => <div key={genre}><span>{genre}<b>{count}</b></span><i><em style={{ width: `${count / maxGenre * 100}%` }} /></i></div>)}{!statistics.favoriteGenres.length && <div className="stats-empty">Здесь появятся жанры после просмотра серий.</div>}</div>
      </section>
      <section className="statistics-panel">
        <h3>Чаще всего пересматриваешь</h3><p>Повторные завершения одной и той же серии</p>
        <div className="rewatch-list">{statistics.mostRewatched.map((item, index) => <article key={item.animeId}><b>{index + 1}</b><span>{item.title}</span><em>{item.count}×</em></article>)}{!statistics.mostRewatched.length && <div className="stats-empty">Пересмотры начнут учитываться после этого обновления.</div>}</div>
      </section>
    </div>
  </section>;
}


function FolderView({ folder, known, progress, cardMeta, onOpen, onNote, onReorder, onDelete, onClose }: { folder: Folder; known: (id: number) => Anime | undefined; progress: Progress; cardMeta: Record<number, CardMeta>; onOpen: (a: Anime, resume?: boolean) => void; onNote: (id: number, note: string) => void; onReorder: (from: number, to: number) => void; onDelete: () => void; onClose: () => void ;}) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal folder-view" onMouseDown={e => e.stopPropagation()}><button className="modal-close" onClick={onClose}>×</button><div className="folder-view-head"><div><span className="eyebrow">ПАПКА · ПЕРЕТАЩИ ДЛЯ СОРТИРОВКИ</span><h2>{folder.name}</h2></div><button className="danger outline" onClick={onDelete}>Удалить папку</button></div><div className="folder-anime-list">{folder.animeIds.map(id => { const a = known(id), p = progress[id], state = p?.episodes[`${p.season ?? 1}:${p.episode}`] ?? Object.values(p?.episodes ?? {}).sort((x, y) => y.updatedAt - x.updatedAt)[0], whole = watchTimeProgress(p); return <article draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(id))} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onReorder(Number(e.dataTransfer.getData("text/plain")), id) ;}} key={id}><span className="drag">⠿</span>{a?.poster?.big && <img className="folder-anime-link" src={a.poster.big} alt="" onClick={() => onOpen(a, false)} />}<div><h3 className={a ? "folder-anime-link" : ""} onClick={() => a && onOpen(a, false)}>{a?.title ?? `Загружаем аниме #${id}…`}</h3><ReleaseMark anime={a} status={cardMeta[id]?.status} /><p>{p?.totalEpisodes ?? "—"} серий · сезон {p?.season ?? 1} · {whole}% всего</p><div className="wide-progress"><i style={{ width: `${whole}%` }} /></div><textarea value={folder.notes?.[id] ?? ""} onChange={e => onNote(id, e.target.value)} placeholder="Своя заметка об аниме…" /></div><aside><small>Остановились: {formatTime(state?.position ?? 0)}</small>{a && <button className="primary" onClick={() => onOpen(a, true)}>▶ Продолжить</button>}</aside></article> ;})}{!folder.animeIds.length && <div className="empty">В этой папке пока нет аниме</div>}</div></div></div> ;}
