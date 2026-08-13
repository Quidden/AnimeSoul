/**
 * Google Drive Connection & Sync Status object returned from /api/gdrive/status.
 */
export type GDriveStatus = {
  /** True if user has valid Google OAuth tokens stored */
  connected: boolean;
  /** Primary email address of connected Google account */
  user_email: string;
  /** Full name of connected Google account */
  user_name: string;
  /** True if OAuth Client ID is configured */
  has_credentials: boolean;
  /** Active Google OAuth Client ID string */
  client_id: string;
  /** True if a storage backup file already exists on Google Drive */
  has_cloud_file?: boolean;
  /** True if user connected Google Drive with existing cloud file but hasn't made initial choice yet */
  choice_pending?: boolean;
  /** Real upload lifecycle reported by the backend */
  sync_state?: "idle" | "syncing" | "synced" | "error";
  sync_running?: boolean;
  sync_pending?: boolean;
  /** Unix timestamps in seconds */
  last_sync_at?: number;
  last_sync_started_at?: number;
  last_sync_error?: string;
};

/**
 * Synchronization modes supported by AnimeSoul:
 * - "auto": Periodic background sync (executes merge logic when initial choice is completed)
 * - "local": Forced upload (Local -> Cloud)
 * - "cloud": Forced download (Cloud -> Local)
 * - "merge": Smart bidirectional merge (prefers watched episodes and merges lists)
 * - "anime_only": Bidirectional anime list & progress merge while strictly preserving local themes & player prefs
 */
export type GDriveSyncMode = "auto" | "local" | "cloud" | "merge" | "anime_only";

/** Location in Google Drive for storage file ("visible" in AnimeSoul folder, or "appdata" hidden folder) */
export type GDriveFolderMode = "visible" | "appdata";

/**
 * Fetches the current Google Drive authentication and synchronization status.
 */
export async function fetchGDriveStatus(): Promise<GDriveStatus> {
  const res = await fetch("/api/gdrive/status");
  if (!res.ok) throw new Error("Failed to fetch Google Drive status");
  return res.json();
}

/**
 * Fetches the OAuth 2.0 authorization URL for Google Sign-In.
 */
export async function fetchGDriveAuthUrl(): Promise<{ url: string; redirect_uri: string }> {
  const res = await fetch("/api/gdrive/auth-url");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to get auth URL" }));
    throw new Error(err.detail || "Failed to get auth URL");
  }
  return res.json();
}

/**
 * Saves custom Google OAuth Client ID and Secret to backend credentials storage.
 */
export async function saveGDriveCredentials(clientId: string, clientSecret?: string): Promise<void> {
  const res = await fetch("/api/gdrive/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret?.trim() || null,
    }),
  });
  if (!res.ok) throw new Error("Failed to save Google OAuth credentials");
}

/**
 * Revokes Google Drive access tokens and disconnects cloud sync.
 */
export async function disconnectGDrive(): Promise<void> {
  const res = await fetch("/api/gdrive/disconnect", { method: "POST" });
  if (!res.ok) throw new Error("Failed to disconnect Google Drive");
}

/**
 * Triggers a Google Drive synchronization request with specified mode.
 *
 * @param mode Synchronization strategy ("auto", "merge", "anime_only", "cloud", "local")
 * @param preferWatched Whether watched episodes take priority during merge
 * @param folderMode Drive folder storage location ("visible" or "appdata")
 */
export async function syncGDrive(
  mode: GDriveSyncMode = "auto",
  preferWatched = true,
  folderMode: GDriveFolderMode = "visible",
): Promise<{ status: string; file_id?: string; document?: unknown }> {
  const res = await fetch("/api/gdrive/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      prefer_watched: preferWatched,
      folder_mode: folderMode,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Sync failed" }));
    throw new Error(err.detail || "Sync failed");
  }
  return res.json();
}
