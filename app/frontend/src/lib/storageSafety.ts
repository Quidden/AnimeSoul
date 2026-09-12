/** Pure save-validation and revision helpers (no browser/runtime dependencies). */

export const SYNCED_SNAPSHOT_FIELDS = [
  "favorites",
  "folders",
  "progress",
  "ratings",
  "tracked",
  "theme",
  "toolbar",
  "playerPrefs",
  "historyClearedAt",
  "historyEnabled",
  "libraryExpanded",
  "watchingExpanded",
  "historyExpanded",
  "watchingHidden",
] as const;

export type SyncedSnapshotField = (typeof SYNCED_SNAPSHOT_FIELDS)[number];

export function isStorageDocumentShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const document = value as {
    activeProfile?: unknown;
    profiles?: Array<{ id?: unknown; snapshot?: unknown }>;
  };
  if (!Array.isArray(document.profiles) || !document.profiles.length) return false;
  if (!document.profiles.every(profile => (
    profile
    && typeof profile === "object"
    && typeof profile.id === "string"
    && Boolean(profile.id.trim())
    && profile.snapshot
    && typeof profile.snapshot === "object"
    && !Array.isArray(profile.snapshot)
  ))) return false;
  return document.activeProfile === undefined
    || document.profiles.some(profile => profile.id === document.activeProfile);
}

export function backfillFieldRevisions(
  revisions: Record<string, number> | undefined,
  fallback: number,
): Record<string, number> {
  return Object.fromEntries(
    SYNCED_SNAPSHOT_FIELDS.map(field => [
      field,
      Number(revisions?.[field]) || fallback,
    ]),
  );
}

export function changedFieldRevisions(
  previous: Partial<Record<SyncedSnapshotField, unknown>> | undefined,
  next: Record<SyncedSnapshotField, unknown>,
  revisions: Record<string, number> | undefined,
  now: number,
): Record<string, number> {
  const updated = { ...(revisions ?? {}) };
  for (const field of SYNCED_SNAPSHOT_FIELDS) {
    if (JSON.stringify(previous?.[field]) !== JSON.stringify(next[field])) {
      updated[field] = now;
    }
  }
  return updated;
}
