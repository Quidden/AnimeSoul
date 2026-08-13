import { DEFAULT_PLAYER_PREFS, SCHEMA_VERSION, STORAGE_KEYS, THEMES } from "./settings";
import type { AnimeProgress, AnimeUserRatings, ConfigSnapshot, Folder, StorageDocument, ToolbarPosition } from "./types";

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

/**
 * Device UI state takes priority over an asynchronously loaded profile copy.
 * This prevents an older storage-server snapshot from reopening a section that
 * the user has already collapsed in the current browser or desktop app.
 */
export function resolveStoredBoolean(
  localValue: unknown,
  snapshotValue: unknown,
  fallback: boolean,
): boolean {
  if (typeof localValue === "boolean") return localValue;
  if (typeof snapshotValue === "boolean") return snapshotValue;
  return fallback;
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
                  title: typeof item.title === "string" ? item.title : undefined,
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
    ratings:
      input?.ratings && typeof input.ratings === "object"
        ? Object.fromEntries(
            Object.entries(input.ratings)
              .filter(([animeId, value]) => Number.isFinite(Number(animeId)) && value && typeof value === "object")
              .map(([animeId, value]) => {
                const item = value as Partial<AnimeUserRatings>;
                return [
                  animeId,
                  {
                    title: typeof item.title === "string" ? item.title : undefined,
                    anime: validUserRating(item.anime),
                    seasons: normalizeUserRatingMap(item.seasons),
                    episodes: normalizeUserRatingMap(item.episodes),
                    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : undefined,
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
            const pendingOtherDubEpisodeKeys = Array.isArray(item.pendingOtherDubEpisodeKeys)
              ? [...new Set(item.pendingOtherDubEpisodeKeys.filter((key) => typeof key === "string"))]
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
              knownAnyEpisodeKeys: Array.isArray(item.knownAnyEpisodeKeys)
                ? [...new Set(item.knownAnyEpisodeKeys.filter((key) => typeof key === "string"))]
                : undefined,
              pendingOtherDubEpisodeKeys,
              otherDubEpisodes: pendingOtherDubEpisodeKeys.length,
              dubs: Array.isArray(item.dubs)
                ? [...new Set(item.dubs.filter((dub) => typeof dub === "string"))]
                : [],
              lastCheckedAt: Number.isFinite(item.lastCheckedAt) ? item.lastCheckedAt : undefined,
              lastNewEpisodeAt: Number.isFinite(item.lastNewEpisodeAt) ? item.lastNewEpisodeAt : undefined,
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
    libraryExpanded: typeof input?.libraryExpanded === "boolean" ? input.libraryExpanded : undefined,
    watchingExpanded: typeof input?.watchingExpanded === "boolean" ? input.watchingExpanded : undefined,
    historyExpanded: typeof input?.historyExpanded === "boolean" ? input.historyExpanded : undefined,
    watchingHidden: Array.isArray(input?.watchingHidden) ? input.watchingHidden.filter(Number.isFinite) : [],
    animeTitles:
      input?.animeTitles && typeof input.animeTitles === "object"
        ? Object.fromEntries(
            Object.entries(input.animeTitles).filter(
              ([animeId, title]) => Number.isFinite(Number(animeId)) && typeof title === "string",
            ),
          )
        : {},
  };
}

function validUserRating(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10
    ? value
    : undefined;
}

function normalizeUserRatingMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, score]) => [key, validUserRating(score)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
  );
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
    // Keep envelope fields added by newer AnimeSoul builds. The main
    // The main React app can therefore open and save a legacy document
    // without silently deleting data it does not understand yet.
    ...input,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: input?.updatedAt || new Date().toISOString(),
    activeProfile,
    profiles: ensured,
  };
}

// FastAPI owns persistence in the main build. The Vite dev server
// proxies this same-origin endpoint, so packaged and development builds use
// exactly the same storage contract.
export const STORAGE_URL = "/api/storage";

export function saveStorageDocument(document: StorageDocument) {
  const mode = readLocal("animesoul:gdrive-auto-sync-mode", "instant");
  const initialChoiceDone = readLocal("animesoul:gdrive-initial-choice-done", false);
  const hasCloudFile = readLocal("animesoul:gdrive-has-cloud-file", false);

  // Block automatic background sync if a cloud file exists and user hasn't made initial choice
  const allowAutoSync = mode === "instant" && (!hasCloudFile || initialChoiceDone);
  const autoSyncParam = allowAutoSync ? "true" : "false";

  return fetch(`${STORAGE_URL}?auto_sync=${autoSyncParam}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
}

export { STORAGE_KEYS };
