import type { CredentialCheck } from "../features/settings/credentialImport";

export type OfflineEpisode = {
  id: string;
  animeId: number;
  season: number;
  episode: string;
  originAnimeId?: number;
  originEpisode?: string;
  dubbing: string;
  translationId?: number | string;
  quality: number;
  duration?: number;
  mediaType?: "video/mp4" | "application/vnd.apple.mpegurl";
  downloadedAt: number;
  mediaUrl: string;
  previewUrl?: string;
  sizeBytes: number;
  skips?: {
    opening?: { time: number; length: number };
    ending?: { time: number; length: number };
  };
};

export type OfflineAnime = {
  animeId: number;
  title: string;
  year?: number;
  poster?: string;
  posterUrl?: string;
  episodes: OfflineEpisode[];
  sizeBytes: number;
};

export type DownloadJob = {
  id: string;
  status: "queued" | "downloading" | "paused" | "completed" | "cancelled" | "error";
  title: string;
  quality: number;
  total: number;
  completed: number;
  progress: number;
  current: string;
  error: string;
  pauseReason?: "mobile-network" | "";
  createdAt: number;
};

export type OfflineLibrary = {
  directory: string;
  anime: OfflineAnime[];
  jobs: DownloadJob[];
  storage: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    libraryBytes: number;
  };
};

export type OfflineSettings = {
  directory: string;
  kodikPublicKeyConfigured: boolean;
  kodikPrivateKeyConfigured: boolean;
  allowMobileDownloads: boolean;
};

export type OfflineSettingsUpdate = {
  directory: string;
  kodikPublicKey?: string;
  kodikPrivateKey?: string;
  clearKodikPublicKey?: boolean;
  clearKodikPrivateKey?: boolean;
  allowMobileDownloads?: boolean;
};

export type KodikCredentialValidation = {
  canSave: boolean;
  checks: CredentialCheck[];
};

type AndroidDownloadBridge = {
  prepareNotificationPermission?: () => void;
  startForegroundMonitoring?: () => void;
  notifyMobileDownloadsBlocked?: () => void;
};

let lastNativeMonitorRequest = 0;
const offlineAnimeCache = new Map<number, OfflineAnime | null>();

function androidDownloadBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { AnimeSoulDownloads?: AndroidDownloadBridge }).AnimeSoulDownloads;
}

/** Request Android 13 notification access in direct response to the download click. */
function prepareNativeDownloadNotification() {
  try {
    androidDownloadBridge()?.prepareNotificationPermission?.();
  } catch {
    // Desktop/browser builds and older APKs intentionally continue without it.
  }
}

/** Ensure the native poller is alive without coupling it to React/WebView timers. */
function startNativeDownloadMonitoring(force = false) {
  const now = Date.now();
  if (!force && now - lastNativeMonitorRequest < 5_000) return;
  try {
    androidDownloadBridge()?.startForegroundMonitoring?.();
    lastNativeMonitorRequest = now;
  } catch {
    // The local Python queue remains usable if the native bridge is unavailable.
  }
}

export const KODIK_ACCESS_CHANGED_EVENT = "animesoul:kodik-access-changed";

/** Direct playback and downloads require the complete private Kodik API pair. */
export function hasKodikSecretAccess(
  settings: Pick<OfflineSettings, "kodikPublicKeyConfigured" | "kodikPrivateKeyConfigured">,
) {
  return settings.kodikPublicKeyConfigured && settings.kodikPrivateKeyConfigured;
}

export type DownloadEpisodeRequest = {
  videoId: number | string;
  season: number;
  episode: string;
  originAnimeId?: number;
  originEpisode?: string;
  dubbing: string;
  translationId?: number | string;
  iframeUrl: string;
  sourceId?: string;
  sourceIdType?: string;
  sourceTitle?: string;
  sourceOriginalTitle?: string;
  duration?: number;
  previewUrl?: string;
};

export type DownloadJobRequest = {
  animeId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  quality: number;
  episodes: DownloadEpisodeRequest[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Офлайн-библиотека временно недоступна.");
  }
  return response.json() as Promise<T>;
}

export const peekOfflineAnime = (animeId: number) => offlineAnimeCache.get(animeId) ?? null;
export const hasOfflineAnimeLookup = (animeId: number) => offlineAnimeCache.has(animeId);

export const fetchOfflineAnime = async (animeId: number) => {
  const result = await api<{ anime: OfflineAnime | null }>(`/api/downloads/anime/${animeId}`, { cache: "no-store" });
  offlineAnimeCache.set(animeId, result.anime);
  return result.anime;
};

export const fetchOfflineLibrary = async () => {
  const library = await api<OfflineLibrary>("/api/downloads/library", { cache: "no-store" });
  for (const animeId of offlineAnimeCache.keys()) offlineAnimeCache.set(animeId, null);
  for (const item of library.anime) offlineAnimeCache.set(item.animeId, item);
  const hasActiveJobs = library.jobs.some(job => ["queued", "downloading", "paused"].includes(job.status));
  if (hasActiveJobs) {
    startNativeDownloadMonitoring();
  } else {
    lastNativeMonitorRequest = 0;
  }
  return library;
};
export const fetchOfflineSettings = () => api<OfflineSettings>("/api/downloads/settings", { cache: "no-store" });
export const validateKodikCredentials = (payload: Pick<OfflineSettingsUpdate, "kodikPublicKey" | "kodikPrivateKey">) =>
  api<KodikCredentialValidation>("/api/downloads/credentials/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
export const updateOfflineSettings = (payload: OfflineSettingsUpdate) => api<OfflineSettings>("/api/downloads/settings", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const enqueueDownload = async (payload: DownloadJobRequest) => {
  prepareNativeDownloadNotification();
  let job: DownloadJob;
  try {
    job = await api<DownloadJob>("/api/downloads/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof Error && error.message.toLocaleLowerCase("ru").includes("мобильн")) {
      try { androidDownloadBridge()?.notifyMobileDownloadsBlocked?.(); } catch { /* optional native bridge */ }
    }
    throw error;
  }
  startNativeDownloadMonitoring(true);
  return job;
};
export const cancelDownload = (jobId: string) => api<{ cancelled: boolean }>(`/api/downloads/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
export const deleteOfflineEpisode = async (episodeId: string) => {
  const result = await api<{ deleted: boolean }>(`/api/downloads/episodes/${encodeURIComponent(episodeId)}`, { method: "DELETE" });
  offlineAnimeCache.clear();
  return result;
};
export const deleteOfflineAnime = async (animeId: number) => {
  const result = await api<{ deleted: number }>(`/api/downloads/anime/${animeId}`, { method: "DELETE" });
  offlineAnimeCache.set(animeId, null);
  return result;
};
