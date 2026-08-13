import type { ReactNode } from "react";
import type { Anime, AnimeProgress, AnimeUserRatings, CommunityAnimeRating, Folder, PlayerPrefs, Tracker } from "../../lib/types";
import type { RatingTarget } from "../../lib/ratings";

/** Public contract of the anime watch page. */
export interface WatchProps {
  header: ReactNode;
  anime: Anime;
  resumeRequested: boolean;
  newEpisodeRequested: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onBack: () => void;
  onLibrary: () => void;
  onGenre: (genre: string) => void;
  saved?: AnimeProgress;
  ratings?: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  onRatingChange: (target: RatingTarget, value: number | undefined) => void;
  onProgress: (
    value: AnimeProgress,
    originEpisodeKey?: string | string[],
    changedEpisodeKey?: string | string[],
  ) => void;
  onPlayerPrefsChange: (prefs: PlayerPrefs) => void;
  onFolders: () => void;
  tracker?: Tracker;
  onTrack: (
    knownEpisodeCount: number,
    dubbings: string[],
    animeIds: number[],
    title: string,
    knownEpisodeKeys: string[],
  ) => void;
  onUntrack: () => void;
  folderPicker: Anime | null;
  folders: Folder[];
  toggleFolder: (folder: Folder, animeId: number) => void;
  createFolder: () => unknown;
  closePicker: () => void;
}
