"use client";

import { useState } from "react";
import type { Anime, AnimeProgress, SeasonGroup, Tracker, Video } from "../../lib/types";

interface WatchInfoProps {
  anime: Anime;
  seasons: SeasonGroup[];
  seasonVideos: Record<number, Video[]>;
  dubs: string[];
  activeDub: string;
  familyTitle: string;
  tracker?: Tracker;
  totalEpisodes: number;
  totalDuration: number;
  downloadAvailable: boolean;
  downloadActive: boolean;
  downloadStatus?: string;
  onDownload: () => void;
  onTrack: (
    knownEpisodeCount: number,
    dubbings: string[],
    animeIds: number[],
    title: string,
    knownEpisodeKeys: string[],
  ) => void;
  onUntrack: () => void;
  onResetProgress: (value: AnimeProgress) => void;
}

/** Actions below the title poster, including downloads and tracking. */
export function WatchInfo({
  seasons,
  seasonVideos,
  dubs,
  activeDub,
  familyTitle,
  tracker,
  totalEpisodes,
  totalDuration,
  downloadAvailable,
  downloadActive,
  downloadStatus,
  onDownload,
  onTrack,
  onUntrack,
  onResetProgress,
}: WatchInfoProps) {
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackedDubs, setTrackedDubs] = useState<string[]>(tracker?.dubs ?? []);
  const allVideos = Object.values(seasonVideos).flat();

  const saveTracking = () => {
    const knownEpisodeKeys = [
      ...new Set(
        allVideos
          .filter(video => Boolean(video.iframe_url?.trim()))
          .filter(video => !trackedDubs.length || trackedDubs.includes(video.data.dubbing))
          .map(video => `${video.originAnimeId}:${video.originNumber}`),
      ),
    ];
    const animeIds = seasons.flatMap(season => season.entries.map(entry => entry.anime_id));
    onTrack(knownEpisodeKeys.length, trackedDubs, animeIds, familyTitle, knownEpisodeKeys);
    setTrackingOpen(false);
  };

  const resetProgress = () => {
    if (!confirm("Обнулить весь прогресс этого аниме?")) return;
    onResetProgress({
      episode: "1",
      dub: activeDub,
      season: 1,
      totalEpisodes,
      totalDuration,
      episodes: {},
      resetAt: Date.now(),
    });
  };

  return <div className="watch-poster-actions">
    <aside>
      {downloadAvailable && (
        <button
          className={downloadActive ? "download-active" : undefined}
          title={downloadStatus || "Выбрать серии, озвучку и качество"}
          onClick={onDownload}
        >
          {downloadActive ? "⇩ Загрузки в очереди" : "⇩ Скачать серии"}
        </button>
      )}
      <button onClick={() => setTrackingOpen(open => !open)}>
        {tracker ? "◉ Настроить отслеживание" : "◎ Следить за франшизой"}
      </button>

      {trackingOpen && <div className="track-settings">
        <b>Озвучки всей франшизы</b>
        <label>
          <input type="checkbox" checked={!trackedDubs.length} onChange={() => setTrackedDubs([])} />
          Все озвучки
        </label>
        {dubs.map(dubbing => <label key={dubbing}>
          <input
            type="checkbox"
            checked={trackedDubs.includes(dubbing)}
            onChange={() => setTrackedDubs(current =>
              current.includes(dubbing)
                ? current.filter(item => item !== dubbing)
                : [...current, dubbing],
            )}
          />
          {dubbing}
        </label>)}
        <button onClick={saveTracking}>Сохранить</button>
        {tracker && <button className="danger" onClick={onUntrack}>Отключить</button>}
      </div>}

      <button className="danger" onClick={resetProgress}>↺ Обнулить прогресс</button>
    </aside>
  </div>;
}
