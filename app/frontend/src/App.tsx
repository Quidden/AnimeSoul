import { useMemo, useRef, useState } from "react";

import {
    CollectionOverview,
    type CollectionOverviewKind,
} from "./components/CollectionOverview";
import { FolderPicker } from "./components/FolderPicker";
import { AppFooter } from "./components/AppFooter";
import { Header } from "./components/Header";
import { Watch } from "./components/Player";
import { useCatalogController } from "./features/catalog/useCatalogController";
import { useCatalogPresentation } from "./features/catalog/useCatalogPresentation";
import {
    calculateAnimeProgress,
    calculateAnimeStatistics,
    calculateFolderProgress,
    selectHistoryItems,
    selectWatchingItems,
} from "./features/library/selectors";
import { useFolderManagement } from "./features/library/useFolderManagement";
import { useAppNavigation } from "./features/navigation/useAppNavigation";
import { useResumePreview } from "./features/player/useResumePreview";
import { createActiveWatchActions } from "./features/player/activeWatchActions";
import { useProfileStorage } from "./features/storage/useProfileStorage";
import { useApiActivity } from "./hooks/useApiActivity";
import { useEpisodeTracking } from "./hooks/useEpisodeTracking";
import { useWatchPartyPresence } from "./hooks/useWatchParty";
import { usePartyHostPlayback } from "./features/watch-party/usePartyHostPlayback";
import type { Anime, Folder } from "./lib/types";
import { STORAGE_KEYS as K } from "./lib/settings";
import { writeLocal as write } from "./lib/storage";
import {
    animeSearchScore,
    reorder,
} from "./lib/anime";
import { compareTrackedByRelease } from "./lib/tracking";
import { StatisticsPage } from "./pages/StatisticsPage";
import { FolderView } from "./pages/FolderView";
import { CatalogPage } from "./pages/CatalogPage";
import {
    HomePage,
    type HomePageActions,
    type HomePageModel,
} from "./pages/HomePage";
import { hasUserRatings, setUserRating, type RatingTarget } from "./lib/ratings";
import { RatingsPage } from "./pages/RatingsPage";
import { useCommunityRatings } from "./features/ratings/useCommunityRatings";
import { DownloadsPage } from "./features/downloads/DownloadsPage";
import { IS_ANDROID_APP } from "./lib/platform";

export default function Home() {
    const catalogRef = useRef<Anime[]>([]);
    const {
        favorites,
        folders,
        saveFolders,
        progress,
        setProgress,
        saveProgress,
        ratings,
        saveRatings,
        tracked,
        setTracked,
        saveTracked,
        theme,
        setTheme,
        playerPrefs,
        setPlayerPrefs,
        profiles,
        activeProfile,
        historyClearedAt,
        setHistoryClearedAt,
        historyEnabled,
        changeHistoryEnabled,
        watchingHidden,
        setWatchingHidden,
        libraryExpanded,
        setLibraryExpanded,
        watchingExpanded,
        setWatchingExpanded,
        historyExpanded,
        setHistoryExpanded,
        reloadStorage,
        exportConfig,
        switchProfile,
        importConfig,
        saveFavorites: saveFav,
        storageReady,
    } = useProfileStorage({
        getCatalog: () => catalogRef.current,
        resolveAnimeTitle: animeId =>
            catalogRef.current.find(anime => anime.anime_id === animeId)?.title,
    });

    const {
        active,
        catalog,
        error,
        dubbingFilter,
        formatFilter,
        genre,
        groupFilter,
        loading,
        newEpisodeRequested,
        query,
        randomGenre,
        randomOpen,
        randomRating,
        randomYearFrom,
        randomYearTo,
        ratingFrom,
        ratingSource,
        resumeRequested,
        sort,
        storedIds,
        view,
        yearFrom,
        yearTo,
        load,
        loadMore,
        setActive,
        setCatalog,
        setDubbingFilter,
        setFormatFilter,
        setGenre,
        setGroupFilter,
        setNewEpisodeRequested,
        setQuery,
        setRandomGenre,
        setRandomOpen,
        setRandomRating,
        setRandomYearFrom,
        setRandomYearTo,
        setRatingFrom,
        setRatingSource,
        setResumeRequested,
        setSort,
        setView,
        setYearFrom,
        setYearTo,
    } = useCatalogController({
        favorites,
        folders,
        progress,
        ratings,
        setProgress,
    });
    catalogRef.current = catalog;
    const communityAnimeIds = useMemo(
        () => [...new Set([
            ...catalog.map(anime => anime.anime_id),
            ...Object.keys(ratings).map(Number),
        ])],
        [catalog, ratings],
    );
    const {communityRatings, queueRatingRemoval} = useCommunityRatings({
        animeIds: communityAnimeIds,
        personalRatings: ratings,
    });

    const [collectionOverview, setCollectionOverview] =
        useState<CollectionOverviewKind | null>(null);
    const partyPresence = useWatchPartyPresence({
        enabled: !IS_ANDROID_APP && view === "home" && playerPrefs.watchPartyEnabled,
        server: playerPrefs.watchPartyServer
    });
    useApiActivity();
    useEpisodeTracking({tracked, setTracked});
    const {
        confirmFolderDeletion,
        createFolder,
        currentFolder,
        deleteFolder,
        folderPicker,
        lastDeletedFolder,
        removeFromFolder,
        reorderFolderAnime,
        restoreLastFolder,
        setFolderPicker,
        setOpenedFolder,
        toggleFolder,
        updateFolderNote,
    } = useFolderManagement({folders, saveFolders});
    const toggleFavorite = (id: number) => {
        const nextFavorites = favorites.includes(id)
            ? favorites.filter(item => item !== id)
            : [...favorites, id];
        saveFav(nextFavorites);
    };
    const known = (id: number) => catalog.find(a => a.anime_id === id);
    const {
        anime: partyHostAnime,
        host: partyHost,
        playback: partyHostPlayback,
    } = usePartyHostPlayback(partyPresence.party, catalog);
    const {
        cardMeta,
        dubbings,
        franchises,
        genres,
        randomCandidates,
        ratingSources,
        requestCardMeta,
        visible,
    } = useCatalogPresentation({
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
        ratings,
        communityRatings,
        sort,
        storedIds,
        view,
        yearFrom,
        yearTo,
    });
    const {
        heroPreviewAnime,
        heroTrailer,
        last,
        lastAnime,
        lastDisplayEpisode,
        lastPoint,
        lastState,
    } = useResumePreview({
        catalog,
        playerPrefs,
        progress,
    });
    const historyItems = useMemo(
        () => selectHistoryItems(progress, historyEnabled, historyClearedAt),
        [progress, historyClearedAt, historyEnabled],
    );
    const watchingItems = useMemo(
        () => selectWatchingItems(progress, watchingHidden),
        [progress, watchingHidden],
    );
    const sortedTracked = useMemo(() => [...tracked].sort(compareTrackedByRelease), [tracked]);
    const totalNewEpisodes = useMemo(() => tracked.reduce((sum, t) => sum + t.newEpisodes, 0), [tracked]);
    const animeProgress = calculateAnimeProgress;
    const folderStats = (folder: Folder) => calculateFolderProgress(folder, progress);
    const statistics = useMemo(
        () => calculateAnimeStatistics(
            progress,
            id => catalog.find(anime => anime.anime_id === id),
        ),
        [progress, catalog],
    );
    const favoriteStats = folderStats({id: "favorites", name: "Избранное", animeIds: favorites});
    const searchSuggestions = useMemo(() => {
        if (query.trim().length < 2) return [];
        return [...franchises]
            .filter(anime => animeSearchScore(anime, query) > 0)
            .sort((left, right) => (
                animeSearchScore(right, query) - animeSearchScore(left, query)
            ))
            .slice(0, 6);
    }, [franchises, query]);
    const {
        goHome,
        openAnime,
        openLibrary,
        openSuggestion,
        showCatalog,
        showDownloads,
        showRatings,
    } = useAppNavigation({
        active,
        view,
        setActive,
        setCatalog,
        setNewEpisodeRequested,
        setQuery,
        setResumeRequested,
        setView,
    });
    const updateRating = (
        animeId: number,
        title: string,
        target: RatingTarget,
        value: number | undefined,
    ) => {
        const record = setUserRating(ratings[animeId], title, target, value);
        const next = {...ratings};
        if (hasUserRatings(record)) next[animeId] = record;
        else {
            delete next[animeId];
            // An empty tree is a tombstone for this browser's shared vote.
            queueRatingRemoval(animeId, record);
        }
        saveRatings(next);
    };
    const searchCatalog = () => {
        showCatalog();
        void load(0, false, query);
    };
    const sharedHeaderProps = {
        query,
        setQuery,
        activeView: active ? "catalog" as const : view,
        onHome: goHome,
        onLibrary: openLibrary,
        onRatings: showRatings,
        onDownloads: showDownloads,
        theme,
        setTheme,
        playerPrefs,
        setPlayerPrefs,
        historyEnabled,
        onHistoryEnabledChange: changeHistoryEnabled,
        suggestions: searchSuggestions,
        onSuggestion: openSuggestion,
        profiles,
        activeProfile,
        onSwitchProfile: switchProfile,
        onExport: exportConfig,
        onImport: importConfig,
        onStorageReload: reloadStorage,
    };
    if (active) {
        const activeTracker = tracked.find(tracker => (
            tracker.animeId === active.anime_id
            || tracker.animeIds?.includes(active.anime_id)
        ));
        const watchHeader = (
            <Header
                {...sharedHeaderProps}
                onSearch={searchCatalog}
                onCatalog={showCatalog}
            />
        );
        const activeWatchActions = createActiveWatchActions({
            anime: active,
            tracker: activeTracker,
            tracked,
            setProgress,
            setTracked,
            saveTracked,
        });
        const updateActiveProgress = (
            ...args: Parameters<typeof activeWatchActions.updateProgress>
        ) => {
            activeWatchActions.updateProgress(...args);
            if (
                watchingHidden.includes(active.anime_id)
                && Object.values(args[0].episodes).some(state => state.position > 0)
            ) {
                const nextHidden = watchingHidden.filter(id => id !== active.anime_id);
                setWatchingHidden(nextHidden);
                write(K.watchingHidden, nextHidden);
            }
        };

        return (
            <Watch
                header={watchHeader}
                anime={active}
                resumeRequested={resumeRequested}
                newEpisodeRequested={newEpisodeRequested}
                favorite={favorites.includes(active.anime_id)}
                onFavorite={() => toggleFavorite(active.anime_id)}
                onBack={showCatalog}
                onLibrary={openLibrary}
                onGenre={selectedGenre => {
                    setGenre(selectedGenre);
                    setQuery("");
                    showCatalog();
                    window.scrollTo({top: 0, behavior: "smooth"});
                }}
                saved={progress[active.anime_id]}
                ratings={ratings[active.anime_id]}
                communityRating={communityRatings[active.anime_id]}
                onRatingChange={(target, value) => updateRating(active.anime_id, active.title, target, value)}
                onProgress={updateActiveProgress}
                onPlayerPrefsChange={setPlayerPrefs}
                onFolders={() => setFolderPicker(active)}
                tracker={activeTracker}
                onTrack={activeWatchActions.saveTracker}
                onUntrack={activeWatchActions.removeTracker}
                folderPicker={folderPicker}
                folders={folders}
                toggleFolder={toggleFolder}
                createFolder={createFolder}
                closePicker={() => setFolderPicker(null)}
            />
        );
    }
    const homePageModel: HomePageModel = {
        party: {
            session: partyPresence.session,
            state: partyPresence.party,
            host: partyHost,
            playback: partyHostPlayback,
            anime: partyHostAnime,
        },
        resume: {
            anime: lastAnime,
            state: lastState,
            point: lastPoint,
            hasStoredResume: Boolean(last),
            displayEpisode: lastDisplayEpisode,
            previewAnime: heroPreviewAnime,
            trailer: heroTrailer,
        },
        playerPrefs,
        favorites,
        folders,
        tracked,
        sortedTracked,
        totalNewEpisodes,
        progress,
        cardMeta,
        favoriteStats,
        watchingItems,
        historyItems,
        watchingHidden,
        lastDeletedFolder,
        libraryExpanded,
        watchingExpanded,
        historyExpanded,
        historyEnabled,
        storageReady,
    };

    const homePageActions: HomePageActions = {
        resolveAnime: known,
        animeProgress,
        folderStats,
        openAnime,
        chooseCatalog: () => {
            setView("catalog");
            window.scrollTo({top: 0, behavior: "smooth"});
        },
        openCollection: kind => setCollectionOverview(kind),
        updatePlayerPrefs: patch => {
            const next = {...playerPrefs, ...patch};
            setPlayerPrefs(next);
            write(K.playerPrefs, next);
        },
        removeFavorite: animeId => {
            saveFav(favorites.filter(item => item !== animeId));
        },
        reorderFavorites: (from, to) => {
            saveFav(reorder(favorites, from, to));
        },
        createFolder,
        deleteFolder,
        restoreLastFolder,
        openFolder: folder => setOpenedFolder(folder),
        removeFromFolder,
        openKnownAnime: animeId => {
            const anime = known(animeId);
            if (anime) setActive(anime);
        },
        watchNewEpisode: animeId => {
            const anime = known(animeId);
            if (!anime) return;
            setResumeRequested(false);
            setNewEpisodeRequested(true);
            setActive(anime);
        },
        untrack: animeId => {
            saveTracked(tracked.filter(item => item.animeId !== animeId));
        },
        setLibraryExpanded: expanded => {
            setLibraryExpanded(expanded);
            write(K.libraryExpanded, expanded);
        },
        setWatchingExpanded: expanded => {
            setWatchingExpanded(expanded);
            write(K.watchingExpanded, expanded);
        },
        hideWatching: animeId => {
            const next = [...new Set([...watchingHidden, animeId])];
            setWatchingHidden(next);
            write(K.watchingHidden, next);
        },
        setHistoryExpanded: expanded => {
            setHistoryExpanded(expanded);
            write(K.historyExpanded, expanded);
        },
        setHistoryEnabled: changeHistoryEnabled,
        clearHistory: () => {
            if (!confirm("Очистить историю просмотра? Прогресс серий сохранится.")) return;
            const now = Date.now();
            setHistoryClearedAt(now);
            write(K.historyClearedAt, now);
        },
        resumeHistory: item => {
            const anime = known(item.animeId);
            if (!anime) return;
            const current = progress[item.animeId];
            saveProgress({
                ...progress,
                [item.animeId]: {
                    ...current,
                    season: item.season,
                    episode: item.episode,
                },
            });
            openAnime(anime, true);
        },
    };

    return (
        <main className="app">
            <Header
                {...sharedHeaderProps}
                onSearch={searchCatalog}
                onCatalog={showCatalog}
            />

            {view === "home" && (
                <HomePage model={homePageModel} actions={homePageActions} />
            )}
            {view === "stats" && (
                <StatisticsPage statistics={statistics} onHome={goHome} />
            )}
            {view === "ratings" && (
                <RatingsPage
                    ratings={ratings}
                    communityRatings={communityRatings}
                    catalog={catalog}
                    onHome={goHome}
                    onOpen={openAnime}
                    onRatingChange={updateRating}
                />
            )}
            {view === "downloads" && (
                <DownloadsPage onCatalog={showCatalog} onOpen={openAnime} progress={progress} />
            )}
            {view === "catalog" && (
                <CatalogPage
                    query={query}
                    sort={sort}
                    groupFilter={groupFilter}
                    formatFilter={formatFilter}
                    dubbingFilter={dubbingFilter}
                    dubbings={dubbings}
                    yearFrom={yearFrom}
                    yearTo={yearTo}
                    genre={genre}
                    genres={genres}
                    randomOpen={randomOpen}
                    randomGenre={randomGenre}
                    randomYearFrom={randomYearFrom}
                    randomYearTo={randomYearTo}
                    randomRating={randomRating}
                    randomCandidates={randomCandidates}
                    ratingSource={ratingSource}
                    ratingFrom={ratingFrom}
                    ratingSources={ratingSources}
                    visible={visible}
                    cardMeta={cardMeta}
                    favorites={favorites}
                    progress={progress}
                    ratings={ratings}
                    communityRatings={communityRatings}
                    error={error}
                    loading={loading}
                    setSort={setSort}
                    setGroupFilter={setGroupFilter}
                    setFormatFilter={setFormatFilter}
                    setDubbingFilter={setDubbingFilter}
                    setYearFrom={setYearFrom}
                    setYearTo={setYearTo}
                    setGenre={setGenre}
                    setRandomOpen={setRandomOpen}
                    setRandomGenre={setRandomGenre}
                    setRandomYearFrom={setRandomYearFrom}
                    setRandomYearTo={setRandomYearTo}
                    setRandomRating={setRandomRating}
                    setRatingSource={setRatingSource}
                    setRatingFrom={setRatingFrom}
                    onHome={goHome}
                    onOpen={openAnime}
                    onFavorite={toggleFavorite}
                    onFolders={setFolderPicker}
                    onCardVisible={requestCardMeta}
                    onLoadMore={() => void loadMore()}
                    onRetry={() => void load(0, false, query)}
                />
            )}

            <AppFooter />

            {collectionOverview && (
                <CollectionOverview
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
                    onRemoveFavorite={id => saveFav(
                        favorites.filter(item => item !== id),
                    )}
                    onDeleteFolder={deleteFolder}
                    onWatchNew={anime => {
                        setCollectionOverview(null);
                        setResumeRequested(false);
                        setNewEpisodeRequested(true);
                        setActive(anime);
                    }}
                    onUntrack={tracker => saveTracked(
                        tracked.filter(item => item.animeId !== tracker.animeId),
                    )}
                />
            )}
            {folderPicker && (
                <FolderPicker
                    anime={folderPicker}
                    folders={folders}
                    onToggle={toggleFolder}
                    onCreate={createFolder}
                    onClose={() => setFolderPicker(null)}
                />
            )}
            {currentFolder && (
                <FolderView
                    folder={currentFolder}
                    known={known}
                    progress={progress}
                    cardMeta={cardMeta}
                    onOpen={(anime, resume) => {
                        setOpenedFolder(null);
                        openAnime(anime, resume);
                    }}
                    onNote={updateFolderNote}
                    onReorder={reorderFolderAnime}
                    onDelete={confirmFolderDeletion}
                    onClose={() => setOpenedFolder(null)}
                />
            )}
        </main>
    );
}
