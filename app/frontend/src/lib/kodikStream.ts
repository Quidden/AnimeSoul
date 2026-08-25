export type KodikStreamRequest = {
  videoId: number | string;
  season: number;
  episode: string;
  originAnimeId?: number;
  originEpisode?: string;
  dubbing: string;
  translationId?: number | string;
  iframeUrl: string;
  sourceId?: string;
  sourceIdType?: "shikimori" | "kinopoisk";
  sourceTitle?: string;
  sourceOriginalTitle?: string;
  /** Already resolved local media, used for downloaded episodes. */
  directStream?: KodikStreamInfo;
};

export type KodikDirectSource = {
  quality: number;
  src: string;
  type: string;
};

export type KodikSubtitle = {
  src: string;
  label: string;
  language: string;
  default?: boolean;
};

export type KodikStreamInfo = {
  sources: KodikDirectSource[];
  subtitles: KodikSubtitle[];
  skips?: {
    opening?: { time: number; length: number };
    ending?: { time: number; length: number };
  };
};

const streamCache = new Map<string, { expiresAt: number; info: KodikStreamInfo }>();

/** Pick a fixed HLS level instead of leaving a requested quality on auto ABR. */
export function hlsLevelForQuality(levels: Array<{ height?: number }>, quality: number) {
  if (!levels.length) return -1;
  const measured = levels
    .map((level, index) => ({ index, height: Number(level.height) || 0 }))
    .filter(level => level.height > 0);
  if (!measured.length) return 0;
  const exact = measured.find(level => level.height === quality);
  if (exact) return exact.index;
  const below = measured
    .filter(level => level.height <= quality)
    .sort((left, right) => right.height - left.height)[0];
  if (below) return below.index;
  return measured.sort((left, right) => left.height - right.height)[0].index;
}

/** Dubbing changes for the same episode can keep the visible video stream intact. */
export function isSameEpisodeDubbingSwitch(
  previous: KodikStreamRequest,
  next: KodikStreamRequest,
) {
  if (kodikStreamEpisodeKey(previous) !== kodikStreamEpisodeKey(next)) return false;
  return previous.dubbing !== next.dubbing
    || previous.translationId !== next.translationId;
}

/** Display episode numbers are local to the combined franchise UI. Resolver
 * metadata identifies the concrete provider episode behind that number. */
export function kodikStreamEpisodeKey(request: KodikStreamRequest) {
  const sourceIdentity = request.originAnimeId != null
    ? ["anime", request.originAnimeId]
    : request.sourceId
      ? [request.sourceIdType, request.sourceId]
      : ["title", request.sourceTitle, request.sourceOriginalTitle];
  return JSON.stringify([
    request.season,
    request.episode,
    request.originEpisode ?? request.episode,
    ...sourceIdentity,
  ]);
}

/** Audio carriers use the lightest rendition because their picture stays hidden. */
export function lowestQualitySource(sources: KodikDirectSource[]) {
  return [...sources].sort((left, right) => left.quality - right.quality)[0];
}

/** Every field consulted by the local resolver belongs to the request
 * identity. Family metadata is filled asynchronously, so omitting it can
 * reuse a stream resolved earlier with another season/title identity. */
export function kodikStreamRequestKey(request: KodikStreamRequest) {
  return JSON.stringify([
    request.videoId,
    request.season,
    request.episode,
    request.originAnimeId,
    request.originEpisode,
    request.dubbing,
    request.translationId,
    request.iframeUrl,
    request.sourceId,
    request.sourceIdType,
    request.sourceTitle,
    request.sourceOriginalTitle,
    request.directStream?.sources.map(source => [source.quality, source.src, source.type]),
  ]);
}

export async function fetchKodikStream(
  request: KodikStreamRequest,
  signal?: AbortSignal,
): Promise<KodikStreamInfo> {
  if (request.directStream) {
    if (!request.directStream.sources.length) {
      throw new Error("Локальный файл этой серии недоступен.");
    }
    return request.directStream;
  }
  const cacheKey = kodikStreamRequestKey(request);
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  const response = await fetch("/api/kodik/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as Partial<KodikStreamInfo> & { detail?: string };
  if (response.status === 404 || response.status === 405) {
    throw new Error(
      "Запущена старая версия сервера AnimeSoul. Полностью закройте приложение и запустите его снова.",
    );
  }
  if (!response.ok) throw new Error(payload.detail || "Не удалось получить прямую ссылку Kodik.");
  if (!Array.isArray(payload.sources) || !payload.sources.length) {
    throw new Error("Kodik не предоставил прямую ссылку для этой серии.");
  }
  const info = {
    sources: payload.sources,
    subtitles: Array.isArray(payload.subtitles) ? payload.subtitles : [],
    skips: payload.skips,
  };
  streamCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, info });
  if (streamCache.size > 80) {
    const oldest = streamCache.keys().next().value;
    if (oldest) streamCache.delete(oldest);
  }
  return info;
}
