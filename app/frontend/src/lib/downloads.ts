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
  downloadedAt: number;
  mediaUrl: string;
  previewUrl?: string;
};

export type OfflineAnime = {
  animeId: number;
  title: string;
  year?: number;
  poster?: string;
  posterUrl?: string;
  episodes: OfflineEpisode[];
};

export type DownloadJob = {
  id: string;
  status: "queued" | "downloading" | "completed" | "cancelled" | "error";
  title: string;
  quality: number;
  total: number;
  completed: number;
  progress: number;
  current: string;
  error: string;
  createdAt: number;
};

export type OfflineLibrary = {
  directory: string;
  anime: OfflineAnime[];
  jobs: DownloadJob[];
};

export type OfflineSettings = {
  directory: string;
  kodikApiTokenConfigured: boolean;
};

export type OfflineSettingsUpdate = {
  directory: string;
  kodikApiToken?: string;
  clearKodikApiToken?: boolean;
};

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

export const fetchOfflineLibrary = () => api<OfflineLibrary>("/api/downloads/library", { cache: "no-store" });
export const fetchOfflineSettings = () => api<OfflineSettings>("/api/downloads/settings", { cache: "no-store" });
export const updateOfflineSettings = (payload: OfflineSettingsUpdate) => api<OfflineSettings>("/api/downloads/settings", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const enqueueDownload = (payload: DownloadJobRequest) => api<DownloadJob>("/api/downloads/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const cancelDownload = (jobId: string) => api<{ cancelled: boolean }>(`/api/downloads/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
export const deleteOfflineEpisode = (episodeId: string) => api<{ deleted: boolean }>(`/api/downloads/episodes/${encodeURIComponent(episodeId)}`, { method: "DELETE" });
export const deleteOfflineAnime = (animeId: number) => api<{ deleted: number }>(`/api/downloads/anime/${animeId}`, { method: "DELETE" });
