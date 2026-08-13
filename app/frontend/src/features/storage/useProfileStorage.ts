import { useEffect, useRef, useState } from "react";

import { usePublishedSaveStatus } from "../../hooks/usePublishedSaveStatus";
import { isLightColor } from "../../lib/anime";
import {
    DEFAULT_PLAYER_PREFS,
    STORAGE_KEYS as K,
    THEMES,
} from "../../lib/settings";
import {
    migrateDocument,
    migrateSnapshot,
    readLocal as read,
    resolveStoredBoolean,
    saveStorageDocument,
    STORAGE_URL,
    writeLocal as write,
} from "../../lib/storage";
import type {
    Anime,
    ConfigProfile,
    ConfigSnapshot,
    Folder,
    PlayerPrefs,
    Progress,
    SaveStatus,
    StorageDocument,
    Theme,
    ToolbarPosition,
    Tracker,
    UserRatings,
} from "../../lib/types";
import {
    buildProfileSnapshot,
    buildStorageDocument,
    resolveActiveProfileDocument,
    upsertProfile,
} from "./profileDocument";

type ProfileStorageOptions = {
    getCatalog: () => Anime[];
    resolveAnimeTitle: (animeId: number) => string | undefined;
};

/**
 * Owns every persisted user preference and profile operation.
 *
 * Keeping this lifecycle outside App.tsx makes the application shell describe
 * screens and navigation instead of storage migrations and localStorage keys.
 */
export function useProfileStorage({
    getCatalog,
    resolveAnimeTitle,
}: ProfileStorageOptions) {
    const [favorites, setFavorites] = useState<number[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [progress, setProgress] = useState<Progress>({});
    const [ratings, setRatings] = useState<UserRatings>({});
    const [tracked, setTracked] = useState<Tracker[]>([]);
    const [theme, setTheme] = useState<Theme>(THEMES[0]);
    const [playerPrefs, setPlayerPrefs] =
        useState<PlayerPrefs>(DEFAULT_PLAYER_PREFS);
    const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
    const [activeProfile, setActiveProfile] = useState("default");
    const [historyClearedAt, setHistoryClearedAt] = useState(0);
    const [historyEnabled, setHistoryEnabled] = useState(true);
    const [watchingHidden, setWatchingHidden] = useState<number[]>(() =>
        read(K.watchingHidden, []),
    );

    // Start collapsed during SSR. Device preferences are restored after mount.
    const [libraryExpanded, setLibraryExpanded] = useState(false);
    const [watchingExpanded, setWatchingExpanded] = useState(false);
    const [historyExpanded, setHistoryExpanded] = useState(false);
    const [storageReady, setStorageReady] = useState(false);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "loading" });

    // Unknown fields are retained so newer and older builds can exchange saves.
    const storageEnvelopeRef = useRef<Partial<StorageDocument>>({});
    usePublishedSaveStatus(saveStatus);

    useEffect(() => {
        setLibraryExpanded(read(K.libraryExpanded, true));
        setWatchingExpanded(read(K.watchingExpanded, true));
        setHistoryExpanded(read(K.historyExpanded, true));
    }, []);

    useEffect(() => {
        if (!storageReady) return;
        setWatchingHidden(read(K.watchingHidden, []));
    }, [storageReady, activeProfile]);

    useEffect(() => {
        const loadedFavorites = read<number[]>(K.favorites, []);
        const loadedFolders = read<Folder[]>(K.folders, []);
        const loadedProgress = read<Progress>(K.progress, {});
        const loadedRatings = read<UserRatings>(K.ratings, {});
        const loadedTracked = read<Tracker[]>(K.tracked, []);
        const loadedTheme = read<Theme>(K.theme, THEMES[0]);
        const loadedToolbar = read<ToolbarPosition>(K.toolbar, "bottom");
        const loadedHistoryClearedAt = read<number>(K.historyClearedAt, 0);
        const loadedHistoryEnabled = read<boolean>(K.historyEnabled, true);
        const active = localStorage.getItem(K.activeProfile) ?? "default";
        let loadedProfiles = read<ConfigProfile[]>(K.profiles, []);

        if (
            active === "default"
            && !loadedProfiles.some(profile => profile.id === "default")
        ) {
            loadedProfiles = [
                {
                    id: "default",
                    name: "Основной",
                    snapshot: {
                        version: 1,
                        name: "Основной",
                        createdAt: new Date().toISOString(),
                        favorites: loadedFavorites,
                        folders: loadedFolders,
                        progress: loadedProgress,
                        ratings: loadedRatings,
                        tracked: loadedTracked,
                        theme: loadedTheme,
                        toolbar: loadedToolbar,
                        historyClearedAt: loadedHistoryClearedAt,
                        historyEnabled: loadedHistoryEnabled,
                    },
                },
                ...loadedProfiles,
            ];
            write(K.profiles, loadedProfiles);
        }

        setFavorites(loadedFavorites);
        setFolders(loadedFolders);
        setProgress(loadedProgress);
        setRatings(loadedRatings);
        setTracked(loadedTracked);
        setTheme(loadedTheme);
        setProfiles(loadedProfiles);
        setActiveProfile(active);
        setHistoryClearedAt(loadedHistoryClearedAt);
        setHistoryEnabled(loadedHistoryEnabled);
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function hydrateFileStorage() {
            try {
                const response = await fetch(STORAGE_URL, { cache: "no-store" });

                if (response.ok) {
                    const resolved = resolveActiveProfileDocument(await response.json());
                    if (!cancelled) {
                        applyStorageProfile(
                            resolved.document,
                            resolved.profile,
                            resolved.snapshot,
                        );
                    }
                } else if (response.status === 404) {
                    const document = createDocumentFromBrowserBackup();
                    storageEnvelopeRef.current = document;
                    const saved = await saveStorageDocument(document);
                    if (!saved.ok) throw Error("Storage unavailable");
                }

                if (!cancelled) {
                    setSaveStatus({ state: "saved", at: Date.now() });
                }
            } catch (error) {
                console.warn(
                    "Локальное файловое хранилище недоступно, используется резервная копия браузера",
                    error,
                );
                if (!cancelled) setSaveStatus({ state: "error" });
            } finally {
                if (!cancelled) setStorageReady(true);
            }
        }

        void hydrateFileStorage();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        document.documentElement.style.setProperty("--accent", theme.accent);
        document.documentElement.style.setProperty(
            "--accent-soft",
            `${theme.accent}33`,
        );
        document.documentElement.style.setProperty("--bg", theme.background);
        const colorScheme = isLightColor(theme.background) ? "light" : "dark";
        document.documentElement.dataset.colorScheme = colorScheme;
        document.documentElement.style.colorScheme = colorScheme;
        document.body.style.backgroundColor = theme.background;
        write(K.theme, theme);
    }, [theme]);

    useEffect(() => {
        const root = document.documentElement;
        const prefs = { ...DEFAULT_PLAYER_PREFS, ...playerPrefs };
        root.style.setProperty("--watched-episode-color", prefs.watchedEpisodeColor);
        root.style.setProperty(
            "--interface-font-scale",
            String(prefs.interfaceFontScale),
        );
        root.style.setProperty(
            "--heading-font-scale",
            String(prefs.headingFontScale),
        );
        root.style.setProperty("--poster-scale", String(prefs.posterScale));
        root.style.setProperty("--preview-scale", String(prefs.previewScale));
    }, [playerPrefs]);

    useEffect(() => {
        setPlayerPrefs(current => ({
            ...current,
            ...read<Partial<PlayerPrefs>>(K.playerPrefs, {}),
        }));
    }, []);

    useEffect(() => {
        if (!storageReady) return;
        setSaveStatus({ state: "saving" });

        const timer = window.setTimeout(async () => {
            const existing = profiles.find(profile => profile.id === activeProfile);
            const name = existing?.name ?? "Основной";
            const snapshot = makeSnapshot(name);
            const nextProfiles = upsertProfile(
                profiles,
                activeProfile,
                name,
                snapshot,
            );
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

        return () => window.clearTimeout(timer);
    }, [
        storageReady,
        favorites,
        folders,
        progress,
        ratings,
        tracked,
        theme,
        playerPrefs,
        historyClearedAt,
        historyEnabled,
        libraryExpanded,
        watchingExpanded,
        historyExpanded,
        watchingHidden,
        activeProfile,
    ]);

    function createDocumentFromBrowserBackup(): StorageDocument {
        const localSnapshot = migrateSnapshot({
            name: "Основной",
            favorites: read(K.favorites, []),
            folders: read(K.folders, []),
            progress: read(K.progress, {}),
            ratings: read(K.ratings, {}),
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

        return migrateDocument({
            activeProfile: active,
            profiles: localProfiles.length
                ? localProfiles
                : [{ id: "default", name: "Основной", snapshot: localSnapshot }],
        });
    }

    function makeSnapshot(name: string): ConfigSnapshot {
        const previous = profiles.find(
            profile => profile.id === activeProfile,
        )?.snapshot;

        return buildProfileSnapshot({
            previous,
            name,
            favorites,
            folders,
            progress,
            ratings,
            catalog: getCatalog(),
            tracked,
            theme,
            toolbar: read(K.toolbar, "bottom"),
            playerPrefs,
            historyClearedAt,
            historyEnabled,
            libraryExpanded,
            watchingExpanded,
            historyExpanded,
            watchingHidden,
            resolveAnimeTitle,
        });
    }

    function makeDocument(
        nextProfiles: ConfigProfile[],
        nextActiveProfile = activeProfile,
    ): StorageDocument {
        const document = buildStorageDocument(
            storageEnvelopeRef.current,
            nextProfiles,
            nextActiveProfile,
        );
        storageEnvelopeRef.current = document;
        return document;
    }

    function applySnapshot(
        input: ConfigSnapshot,
        useSnapshotLayout = false,
    ) {
        const snapshot = migrateSnapshot(input, input.name);
        const layout = {
            library: resolveStoredBoolean(
                useSnapshotLayout
                    ? undefined
                    : read<boolean | undefined>(K.libraryExpanded, undefined),
                snapshot.libraryExpanded,
                true,
            ),
            watching: resolveStoredBoolean(
                useSnapshotLayout
                    ? undefined
                    : read<boolean | undefined>(K.watchingExpanded, undefined),
                snapshot.watchingExpanded,
                true,
            ),
            history: resolveStoredBoolean(
                useSnapshotLayout
                    ? undefined
                    : read<boolean | undefined>(K.historyExpanded, undefined),
                snapshot.historyExpanded,
                true,
            ),
        };

        write(K.favorites, snapshot.favorites);
        write(K.folders, snapshot.folders);
        write(K.progress, snapshot.progress);
        write(K.ratings, snapshot.ratings);
        write(K.tracked, snapshot.tracked);
        write(K.theme, snapshot.theme);
        write(K.toolbar, snapshot.toolbar);
        write(K.playerPrefs, {
            ...DEFAULT_PLAYER_PREFS,
            ...snapshot.playerPrefs,
        });
        write(K.historyClearedAt, snapshot.historyClearedAt ?? 0);
        write(K.historyEnabled, snapshot.historyEnabled ?? true);
        write(K.libraryExpanded, layout.library);
        write(K.watchingExpanded, layout.watching);
        write(K.historyExpanded, layout.history);
        write(K.watchingHidden, snapshot.watchingHidden ?? []);

        setFavorites(snapshot.favorites);
        setFolders(snapshot.folders);
        setProgress(snapshot.progress);
        setRatings(snapshot.ratings);
        setTracked(snapshot.tracked);
        setTheme(snapshot.theme);
        setPlayerPrefs({ ...DEFAULT_PLAYER_PREFS, ...snapshot.playerPrefs });
        setHistoryClearedAt(snapshot.historyClearedAt ?? 0);
        setHistoryEnabled(snapshot.historyEnabled ?? true);
        setLibraryExpanded(layout.library);
        setWatchingExpanded(layout.watching);
        setHistoryExpanded(layout.history);
        setWatchingHidden(snapshot.watchingHidden ?? []);
    }

    function applyStorageProfile(
        document: StorageDocument,
        profile: ConfigProfile,
        snapshot: ConfigSnapshot,
    ) {
        storageEnvelopeRef.current = document;
        applySnapshot(snapshot);
        setProfiles(document.profiles);
        setActiveProfile(profile.id);
        write(K.profiles, document.profiles);
        localStorage.setItem(K.activeProfile, profile.id);
    }

    async function reloadStorage() {
        try {
            const response = await fetch(STORAGE_URL, { cache: "no-store" });
            if (!response.ok) return;
            const resolved = resolveActiveProfileDocument(await response.json());
            applyStorageProfile(
                resolved.document,
                resolved.profile,
                resolved.snapshot,
            );
        } catch (error) {
            console.warn("Failed to reload storage", error);
        }
    }

    function exportConfig() {
        const profileName = profiles.find(
            profile => profile.id === activeProfile,
        )?.name ?? "Основной";
        const blob = new Blob(
            [JSON.stringify(makeSnapshot(profileName), null, 2)],
            { type: "application/json" },
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `AnimeSoul-${profileName.replace(/[^\p{L}\p{N}-]+/gu, "-")}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    async function switchProfile(id: string) {
        if (id === activeProfile) return;
        const existing = profiles.find(profile => profile.id === activeProfile);
        const currentName =
            existing?.name ?? (activeProfile === "default" ? "Основной" : "Профиль");
        const savedCurrent: ConfigProfile = {
            ...(existing ?? {}),
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
    }

    async function importConfig(file: File) {
        try {
            const raw = JSON.parse(await file.text()) as Partial<ConfigSnapshot>;
            const fallbackName = raw.name || file.name.replace(/\.json$/i, "");
            const parsed = migrateSnapshot(raw, fallbackName);
            const name = prompt(
                "Название импортированного профиля",
                parsed.name || fallbackName,
            )?.trim();
            if (!name) return;

            const existing = profiles.find(profile => profile.id === activeProfile);
            const currentName =
                existing?.name
                ?? (activeProfile === "default" ? "Основной" : "Профиль");
            const currentProfile: ConfigProfile = {
                ...(existing ?? {}),
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
                ...profiles.filter(item => item.id !== activeProfile),
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
    }

    function changeHistoryEnabled(enabled: boolean) {
        const now = Date.now();
        setHistoryEnabled(enabled);
        write(K.historyEnabled, enabled);
        setHistoryClearedAt(now);
        write(K.historyClearedAt, now);
    }

    function saveFavorites(value: number[]) {
        setFavorites(value);
        write(K.favorites, value);
    }

    function saveFolders(value: Folder[]) {
        setFolders(value);
        write(K.folders, value);
    }

    function saveProgress(value: Progress) {
        setProgress(value);
        write(K.progress, value);
    }

    function saveRatings(value: UserRatings) {
        setRatings(value);
        write(K.ratings, value);
    }

    function saveTracked(value: Tracker[]) {
        setTracked(value);
        write(K.tracked, value);
    }

    return {
        favorites,
        setFavorites,
        saveFavorites,
        folders,
        setFolders,
        saveFolders,
        progress,
        setProgress,
        saveProgress,
        ratings,
        setRatings,
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
    };
}
