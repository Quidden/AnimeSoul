import {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
} from "react";

import type {ApplicationView} from "../catalog/useCatalogController";
import {NATIVE_BACK_EVENT} from "../../lib/modalAccessibility";
import type {Anime} from "../../lib/types";

type UseAppNavigationOptions = {
    active: Anime | null;
    keepActiveOnNavigation?: boolean;
    watchForeground: boolean;
    view: ApplicationView;
    setActive: Dispatch<SetStateAction<Anime | null>>;
    setCatalog: Dispatch<SetStateAction<Anime[]>>;
    setNewEpisodeRequested: Dispatch<SetStateAction<boolean>>;
    setQuery: Dispatch<SetStateAction<string>>;
    setResumeRequested: Dispatch<SetStateAction<boolean>>;
    setView: Dispatch<SetStateAction<ApplicationView>>;
    setWatchForeground: Dispatch<SetStateAction<boolean>>;
};

function scrollToTop(behavior?: ScrollBehavior) {
    window.scrollTo(behavior ? {top: 0, behavior} : {top: 0});
}

/** Provides stable screen transitions and owns Android/native back navigation. */
export function useAppNavigation({
    active,
    keepActiveOnNavigation = false,
    watchForeground,
    view,
    setActive,
    setCatalog,
    setNewEpisodeRequested,
    setQuery,
    setResumeRequested,
    setView,
    setWatchForeground,
}: UseAppNavigationOptions) {
    const resetToView = useCallback((nextView: ApplicationView, behavior?: ScrollBehavior) => {
        if (keepActiveOnNavigation && active) setWatchForeground(false);
        else setActive(null);
        setResumeRequested(false);
        setNewEpisodeRequested(false);
        setView(nextView);
        scrollToTop(behavior);
    }, [active, keepActiveOnNavigation, setActive, setNewEpisodeRequested, setResumeRequested, setView, setWatchForeground]);

    const openAnime = useCallback((anime: Anime, resume = false) => {
        // Offline-library cards remain playable even when the remote catalog
        // is unavailable, so retain their full record in the active catalog.
        setCatalog(current => current.some(item => item.anime_id === anime.anime_id)
            ? current
            : [...current, anime]);
        setResumeRequested(resume);
        setNewEpisodeRequested(false);
        setActive(anime);
        setWatchForeground(true);
        scrollToTop();
    }, [setActive, setCatalog, setNewEpisodeRequested, setResumeRequested, setWatchForeground]);

    const openLibrary = useCallback(
        () => resetToView("stats", "smooth"),
        [resetToView],
    );
    const showCatalog = useCallback(
        () => resetToView("catalog"),
        [resetToView],
    );
    const showRatings = useCallback(
        () => resetToView("ratings", "smooth"),
        [resetToView],
    );
    const showDownloads = useCallback(
        () => resetToView("downloads", "smooth"),
        [resetToView],
    );
    const goHome = useCallback(
        () => resetToView("home", "smooth"),
        [resetToView],
    );
    const showCurrent = useCallback(() => {
        if (!active) return;
        setWatchForeground(true);
        scrollToTop("smooth");
    }, [active, setWatchForeground]);

    const openSuggestion = useCallback((anime: Anime) => {
        setQuery(anime.title);
        setActive(anime);
        setResumeRequested(false);
        setNewEpisodeRequested(false);
        setWatchForeground(true);
    }, [setActive, setNewEpisodeRequested, setQuery, setResumeRequested, setWatchForeground]);

    useEffect(() => {
        const handleNativeBack = (event: Event) => {
            // Dialog hooks close only the visually topmost modal. App-level
            // navigation must wait for them instead of closing two layers.
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            if (active && (!keepActiveOnNavigation || watchForeground)) {
                event.preventDefault();
                showCatalog();
                return;
            }
            if (view !== "home") {
                event.preventDefault();
                goHome();
            }
        };
        window.addEventListener(NATIVE_BACK_EVENT, handleNativeBack);
        return () => window.removeEventListener(NATIVE_BACK_EVENT, handleNativeBack);
    }, [active, goHome, keepActiveOnNavigation, showCatalog, view, watchForeground]);

    return {
        goHome,
        openAnime,
        openLibrary,
        openSuggestion,
        showCatalog,
        showCurrent,
        showDownloads,
        showRatings,
    };
}
