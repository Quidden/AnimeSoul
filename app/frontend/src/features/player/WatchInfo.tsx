"use client";

import { useState } from "react";
import type { Anime, AnimeProgress, SeasonGroup, Tracker, Video } from "../../lib/types";
import { durationRange, isExtraAnime } from "../../lib/anime";

interface WatchInfoProps {
  anime: Anime;
  seasons: SeasonGroup[];
  seasonVideos: Record<number, Video[]>;
  dubs: string[];
  activeDub: string;
  familyTitle: string;
  favorite: boolean;
  tracker?: Tracker;
  totalEpisodes: number;
  totalDuration: number;
  onGenre: (genre: string) => void;
  onFavorite: () => void;
  onFolders: () => void;
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

/** Description, franchise facts, library actions, and tracking controls. */
export function WatchInfo({
  anime,
  seasons,
  seasonVideos,
  dubs,
  activeDub,
  familyTitle,
  favorite,
  tracker,
  totalEpisodes,
  totalDuration,
  onGenre,
  onFavorite,
  onFolders,
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

  return <div className="watch-info">
    <div>
      <div className="tags">
        {anime.genres?.slice(0, 8).map(genre =>
          <button type="button" key={genre.alias} onClick={() => onGenre(genre.title)}>
            {genre.title}
          </button>,
        )}
      </div>
      <p>{anime.description}</p>
      <div className="facts">
        <span>{seasons.length > 1 ? "◆ Франшиза · всё собрано" : "◇ Отдельный тайтл"}</span>
        <span>{seasons.filter(season => season.kind === "season").length} сезонов</span>
        <span>{seasons.flatMap(season => season.entries).filter(isExtraAnime).length} OVA/ONA/спешлов</span>
        <span>{seasons.filter(season => season.kind === "movie").length} фильмов</span>
        <span>{totalEpisodes} видео всего</span>
        <span>{durationRange(allVideos)}</span>
      </div>
    </div>

    <aside>
      <button onClick={onFavorite}>{favorite ? "♥ В избранном" : "♡ В избранное"}</button>
      <button onClick={onFolders}>＋ Добавить в папку</button>
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
