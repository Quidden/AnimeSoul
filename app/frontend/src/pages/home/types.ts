import type { CollectionOverviewKind } from "../../components/CollectionOverview";
import type { HistoryItem, WatchingItem } from "../../features/library/selectors";
import type { WatchPartySession } from "../../features/watch-party/types";
import type { latestResumePoint } from "../../lib/anime";
import type {
  Anime,
  AnimeProgress,
  CardMeta,
  Folder,
  HeroTrailer,
  PartyParticipant,
  PartyPlayback,
  PartyState,
  PlayerPrefs,
  Progress,
  Tracker,
  Video,
} from "../../lib/types";

type ResumePoint = ReturnType<typeof latestResumePoint>;

export type DeletedFolder = {
  folder: Folder;
  index: number;
};

export type CollectionStats = {
  total: number;
  watched: number;
  percent: number;
};

export type HomePageModel = {
  party: {
    session: WatchPartySession | null;
    state: PartyState | null;
    host?: PartyParticipant;
    playback?: PartyPlayback | null;
    anime?: Anime | null;
  };
  resume: {
    anime?: Anime;
    state?: AnimeProgress;
    point?: ResumePoint;
    displayEpisode: string;
    previewAnime: Anime | null;
    previewVideo: Video | null;
    trailer: HeroTrailer | null;
  };
  playerPrefs: PlayerPrefs;
  favorites: number[];
  folders: Folder[];
  tracked: Tracker[];
  sortedTracked: Tracker[];
  totalNewEpisodes: number;
  progress: Progress;
  cardMeta: Record<number, CardMeta>;
  favoriteStats: CollectionStats;
  watchingItems: WatchingItem[];
  historyItems: HistoryItem[];
  watchingHidden: number[];
  lastDeletedFolder: DeletedFolder | null;
  libraryExpanded: boolean;
  watchingExpanded: boolean;
  historyExpanded: boolean;
  historyEnabled: boolean;
};

export type HomePageActions = {
  resolveAnime: (animeId: number) => Anime | undefined;
  animeProgress: (progress?: AnimeProgress) => number;
  folderStats: (folder: Folder) => CollectionStats;
  openAnime: (anime: Anime, resume?: boolean) => void;
  chooseCatalog: () => void;
  openCollection: (kind: CollectionOverviewKind) => void;
  updatePlayerPrefs: (patch: Partial<PlayerPrefs>) => void;
  removeFavorite: (animeId: number) => void;
  reorderFavorites: (from: number, to: number) => void;
  createFolder: () => void;
  deleteFolder: (folder: Folder) => void;
  restoreLastFolder: () => void;
  openFolder: (folder: Folder) => void;
  removeFromFolder: (folderId: string, animeId: number) => void;
  openKnownAnime: (animeId: number) => void;
  watchNewEpisode: (animeId: number) => void;
  untrack: (animeId: number) => void;
  setLibraryExpanded: (expanded: boolean) => void;
  setWatchingExpanded: (expanded: boolean) => void;
  hideWatching: (animeId: number) => void;
  setHistoryExpanded: (expanded: boolean) => void;
  setHistoryEnabled: (enabled: boolean) => void;
  clearHistory: () => void;
  resumeHistory: (item: HistoryItem) => void;
};

export type HomePageProps = {
  model: HomePageModel;
  actions: HomePageActions;
};
