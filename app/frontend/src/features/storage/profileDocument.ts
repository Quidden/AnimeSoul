import { DEFAULT_PLAYER_PREFS, SCHEMA_VERSION } from "../../lib/settings";
import {
  migrateDocument,
  migrateSnapshot,
} from "../../lib/storage";
import { changedFieldRevisions } from "../../lib/storageSafety";
import type {
  Anime,
  ConfigProfile,
  ConfigSnapshot,
  Folder,
  PlayerPrefs,
  Progress,
  UserRatings,
  StorageDocument,
  Theme,
  ToolbarPosition,
  Tracker,
} from "../../lib/types";

export type ProfileSnapshotInput = {
  previous?: ConfigSnapshot;
  name: string;
  favorites: number[];
  folders: Folder[];
  progress: Progress;
  ratings: UserRatings;
  catalog: Anime[];
  tracked: Tracker[];
  theme: Theme;
  toolbar: ToolbarPosition;
  playerPrefs: PlayerPrefs;
  historyClearedAt: number;
  historyEnabled: boolean;
  libraryExpanded: boolean;
  watchingExpanded: boolean;
  historyExpanded: boolean;
  watchingHidden: number[];
  resolveAnimeTitle: (animeId: number) => string | undefined;
};

export type ActiveProfileDocument = {
  document: StorageDocument;
  profile: ConfigProfile;
  snapshot: ConfigSnapshot;
};

/**
 * Normalizes a persisted envelope and resolves its active profile in one place.
 * `migrateDocument` always supplies at least the default profile, so callers do
 * not need to repeat fallback and migration logic during startup or reload.
 */
export function resolveActiveProfileDocument(
  input: Partial<StorageDocument> | null | undefined,
): ActiveProfileDocument {
  const document = migrateDocument(input);
  const profile =
    document.profiles.find((item) => item.id === document.activeProfile) ??
    document.profiles[0];

  return {
    document,
    profile,
    snapshot: migrateSnapshot(profile.snapshot, profile.name),
  };
}

/**
 * Builds the portable profile payload without reading React state or browser
 * storage. Keeping this transformation pure makes migrations and exports easy
 * to test and prevents profile fields from being lost during future refactors.
 */
export function buildProfileSnapshot(input: ProfileSnapshotInput): ConfigSnapshot {
  const {
    previous,
    name,
    favorites,
    folders,
    progress,
    ratings,
    catalog,
    tracked,
    theme,
    toolbar,
    playerPrefs,
    historyClearedAt,
    historyEnabled,
    libraryExpanded,
    watchingExpanded,
    historyExpanded,
    watchingHidden,
    resolveAnimeTitle,
  } = input;

  const progressWithTitles = Object.fromEntries(
    Object.entries(progress).map(([animeId, item]) => [
      animeId,
      {
        ...item,
        title:
          item.title ??
          resolveAnimeTitle(Number(animeId)) ??
          previous?.animeTitles?.[Number(animeId)],
      },
    ]),
  );
  const nextFields = {
    favorites,
    folders,
    progress: progressWithTitles,
    ratings,
    tracked,
    theme,
    toolbar,
    playerPrefs: { ...DEFAULT_PLAYER_PREFS, ...playerPrefs },
    historyClearedAt,
    historyEnabled,
    libraryExpanded,
    watchingExpanded,
    historyExpanded,
    watchingHidden,
  };
  const now = Date.now();
  const fieldUpdatedAt = changedFieldRevisions(
    previous,
    nextFields,
    previous?.fieldUpdatedAt,
    now,
  );

  return migrateSnapshot(
    {
      // Unknown fields from newer builds must survive a round trip.
      ...previous,
      version: SCHEMA_VERSION,
      name,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      ...nextFields,
      fieldUpdatedAt,
      // Titles are redundant on purpose: they keep exported JSON readable.
      animeTitles: {
        ...(previous?.animeTitles ?? {}),
        ...Object.fromEntries(catalog.map((anime) => [anime.anime_id, anime.title])),
        ...Object.fromEntries(tracked.map((item) => [item.animeId, item.title])),
      },
    },
    name,
  );
}

/** Creates a migrated storage envelope while preserving unknown root fields. */
export function buildStorageDocument(
  envelope: Partial<StorageDocument>,
  profiles: ConfigProfile[],
  activeProfile: string,
): StorageDocument {
  return migrateDocument({
    ...envelope,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    activeProfile,
    profiles,
  });
}

/** Replaces one profile without changing the relative order of other profiles. */
export function upsertProfile(
  profiles: ConfigProfile[],
  id: string,
  name: string,
  snapshot: ConfigSnapshot,
): ConfigProfile[] {
  const existing = profiles.find((profile) => profile.id === id);
  return [
    ...profiles.filter((profile) => profile.id !== id),
    { ...(existing ?? {}), id, name, snapshot },
  ];
}
