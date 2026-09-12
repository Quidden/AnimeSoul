import {
    type Dispatch,
    type SetStateAction,
    useEffect,
    useRef,
} from "react";

import {STORAGE_KEYS as K} from "../../lib/settings";
import {saveStorageDocument, writeLocal} from "../../lib/storage";
import type {
    ConfigProfile,
    ConfigSnapshot,
    Folder,
    PlayerPrefs,
    Progress,
    SaveStatus,
    StorageDocument,
    Theme,
    Tracker,
    UserRatings,
} from "../../lib/types";
import {upsertProfile} from "./profileDocument";

type UseProfileAutosaveOptions = {
    activeProfile: string;
    favorites: number[];
    folders: Folder[];
    historyClearedAt: number;
    historyEnabled: boolean;
    historyExpanded: boolean;
    libraryExpanded: boolean;
    makeDocument: (profiles: ConfigProfile[]) => StorageDocument;
    makeSnapshot: (name: string) => ConfigSnapshot;
    playerPrefs: PlayerPrefs;
    profiles: ConfigProfile[];
    profilesRef: {current: ConfigProfile[]};
    progress: Progress;
    ratings: UserRatings;
    setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
    skipNextAutosaveRef: {current: boolean};
    storageReady: boolean;
    theme: Theme;
    tracked: Tracker[];
    watchingExpanded: boolean;
    watchingHidden: number[];
};

/** Debounces profile persistence and retries transient storage failures. */
export function useProfileAutosave({
    activeProfile,
    favorites,
    folders,
    historyClearedAt,
    historyEnabled,
    historyExpanded,
    libraryExpanded,
    makeDocument,
    makeSnapshot,
    playerPrefs,
    profiles,
    profilesRef,
    progress,
    ratings,
    setSaveStatus,
    skipNextAutosaveRef,
    storageReady,
    theme,
    tracked,
    watchingExpanded,
    watchingHidden,
}: UseProfileAutosaveOptions) {
    const makeSnapshotRef = useRef(makeSnapshot);
    const makeDocumentRef = useRef(makeDocument);
    makeSnapshotRef.current = makeSnapshot;
    makeDocumentRef.current = makeDocument;

    useEffect(() => {
        if (!storageReady) return;
        if (skipNextAutosaveRef.current) {
            skipNextAutosaveRef.current = false;
            return;
        }
        setSaveStatus({state: "saving"});
        const saveController = new AbortController();

        const timer = window.setTimeout(async () => {
            const currentProfiles = profilesRef.current;
            const existing = currentProfiles.find(profile => profile.id === activeProfile);
            const name = existing?.name ?? "Основной";
            const snapshot = makeSnapshotRef.current(name);
            const nextProfiles = upsertProfile(
                currentProfiles,
                activeProfile,
                name,
                snapshot,
            );
            const document = makeDocumentRef.current(nextProfiles);
            writeLocal(K.profiles, nextProfiles);
            // Carry the just-written field revisions into the next edit
            // without creating an autosave dependency loop.
            profilesRef.current = nextProfiles;

            let lastError: unknown;
            for (const delay of [0, 500, 1_500]) {
                if (delay) {
                    try {
                        await abortableDelay(delay, saveController.signal);
                    } catch {
                        return;
                    }
                }
                if (saveController.signal.aborted) return;
                try {
                    const response = await saveStorageDocument(
                        document,
                        saveController.signal,
                    );
                    if (!response.ok) {
                        throw Error(`Storage unavailable (HTTP ${response.status})`);
                    }
                    setSaveStatus({state: "saved", at: Date.now()});
                    return;
                } catch (error) {
                    if (saveController.signal.aborted) return;
                    lastError = error;
                }
            }
            console.warn("Не удалось сохранить данные на диск", lastError);
            setSaveStatus({state: "error"});
        }, 400);

        return () => {
            window.clearTimeout(timer);
            saveController.abort();
        };
    }, [
        activeProfile,
        favorites,
        folders,
        historyClearedAt,
        historyEnabled,
        historyExpanded,
        libraryExpanded,
        playerPrefs,
        profiles,
        profilesRef,
        progress,
        ratings,
        setSaveStatus,
        skipNextAutosaveRef,
        storageReady,
        theme,
        tracked,
        watchingExpanded,
        watchingHidden,
    ]);
}

function abortableDelay(delay: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, {once: true});
    });
}
