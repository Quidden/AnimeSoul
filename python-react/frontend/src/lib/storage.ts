import { DEFAULT_PLAYER_PREFS, SCHEMA_VERSION, STORAGE_KEYS, THEMES } from "./settings";
import type { AnimeProgress, ConfigSnapshot, Folder, StorageDocument, ToolbarPosition } from "./types";

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function migrateSnapshot(
  input: Partial<ConfigSnapshot> | null | undefined,
  name = "Основной",
): ConfigSnapshot {
  return {
    ...input,
    version: SCHEMA_VERSION,
    name: input?.name?.trim() || name,
    createdAt: input?.createdAt || new Date().toISOString(),
    favorites: Array.isArray(input?.favorites) ? input.favorites.filter(Number.isFinite) : [],
    folders: Array.isArray(input?.folders)
      ? input.folders.map((folder: Folder) => ({
          ...folder,
          id: folder.id || crypto.randomUUID(),
          name: folder.name || "Папка",
          animeIds: Array.isArray(folder.animeIds) ? folder.animeIds.filter(Number.isFinite) : [],
          notes: folder.notes ?? {},
        }))
      : [],
    progress:
      input?.progress && typeof input.progress === "object"
        ? Object.fromEntries(
            Object.entries(input.progress).map(([animeId, value]) => {
              const item: Partial<AnimeProgress> =
                value && typeof value === "object" ? value : {};
              return [
                animeId,
                {
                  ...item,
                  episode: typeof item.episode === "string" ? item.episode : "1",
                  dub: typeof item.dub === "string" ? item.dub : "",
                  season: Number.isFinite(item.season) ? item.season : 1,
                  episodes:
                    item.episodes && typeof item.episodes === "object" ? item.episodes : {},
                },
              ];
            }),
          )
        : {},
    tracked: Array.isArray(input?.tracked)
      ? input.tracked
          .filter((item) => item && Number.isFinite(item.animeId))
          .map((item) => {
            const pendingEpisodeKeys = Array.isArray(item.pendingEpisodeKeys)
              ? [...new Set(item.pendingEpisodeKeys.filter((key) => typeof key === "string"))]
              : [];
            return {
              ...item,
              animeIds: Array.isArray(item.animeIds)
                ? [...new Set(item.animeIds.filter(Number.isFinite))]
                : [item.animeId],
              title: typeof item.title === "string" ? item.title : `Аниме #${item.animeId}`,
              knownEpisodes: Number.isFinite(item.knownEpisodes) ? item.knownEpisodes : 0,
              knownEpisodeKeys: Array.isArray(item.knownEpisodeKeys)
                ? [...new Set(item.knownEpisodeKeys.filter((key) => typeof key === "string"))]
                : undefined,
              pendingEpisodeKeys,
              newEpisodes: pendingEpisodeKeys.length || Math.max(0, Number(item.newEpisodes) || 0),
              dubs: Array.isArray(item.dubs)
                ? [...new Set(item.dubs.filter((dub) => typeof dub === "string"))]
                : [],
            };
          })
      : [],
    theme: input?.theme && typeof input.theme === "object" ? { ...THEMES[0], ...input.theme } : THEMES[0],
    toolbar: ["top", "bottom", "left", "right"].includes(input?.toolbar ?? "")
      ? (input!.toolbar! as ToolbarPosition)
      : "bottom",
    playerPrefs: { ...DEFAULT_PLAYER_PREFS, ...input?.playerPrefs },
    historyClearedAt: Number.isFinite(input?.historyClearedAt) ? input!.historyClearedAt : 0,
    historyEnabled: input?.historyEnabled !== false,
    historyExpanded: typeof input?.historyExpanded === "boolean" ? input.historyExpanded : undefined,
    watchingHidden: Array.isArray(input?.watchingHidden) ? input.watchingHidden.filter(Number.isFinite) : [],
  };
}

export function migrateDocument(input: Partial<StorageDocument> | null | undefined): StorageDocument {
  const profiles = Array.isArray(input?.profiles)
    ? input.profiles.map((profile) => ({ ...profile, snapshot: migrateSnapshot(profile.snapshot, profile.name) }))
    : [];
  const ensured = profiles.length
    ? profiles
    : [{ id: "default", name: "Основной", snapshot: migrateSnapshot(undefined) }];
  const activeProfile = ensured.some((profile) => profile.id === input?.activeProfile)
    ? input!.activeProfile!
    : ensured[0].id;
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: input?.updatedAt || new Date().toISOString(),
    activeProfile,
    profiles: ensured,
  };
}

// FastAPI serves storage and the production React bundle from one origin.
// Vite forwards this path to port 8000 while developing the frontend.
export const STORAGE_URL = "/api/storage";

export function saveStorageDocument(document: StorageDocument) {
  return fetch(STORAGE_URL, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
}

export { STORAGE_KEYS };
