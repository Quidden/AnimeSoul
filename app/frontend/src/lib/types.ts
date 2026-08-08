import type { ReactNode } from "react";

/** Screenshot preview data structure for anime titles. */
export type AnimeScreenshot = {
  time?: number;
  id?: number;
  episode?: string;
  sizes?: { small?: string; full?: string };
};

/** Core Anime entity returned from YummyAnime / Shikimori APIs. */
export type Anime = {
  anime_id: number;
  title: string;
  original?: string;
  other_titles?: string[] | string;
  title_en?: string;
  title_ru?: string;
  description?: string;
  year?: number;
  season?: number;
  poster?: { big?: string; fullsize?: string };
  rating?: { average?: number };
  genres?: { title: string; alias: string }[];
  type?: { name?: string; alias?: string; shortname?: string; value?: number };
  data?: { index?: number; text?: string };
  views?: number;
  anime_status?: { value?: number; title?: string; alias?: string };
  viewing_order?: Anime[];
  franchiseCount?: number;
  franchiseEntries?: Anime[];
  random_screenshots?: AnimeScreenshot[];
};

/** Individual video / episode stream data structure. */
export type Video = {
  video_id: number;
  iframe_url: string;
  number: string;
  date?: number;
  duration?: number;
  originAnimeId?: number;
  originNumber?: string;
  contentKind?: "Серия" | "OVA" | "ONA" | "Спешл" | "Фильм";
  contentTitle?: string;
  data: {
    dubbing: string;
    player: string;
    /** Provider identifiers report translation reliably across locales. */
    player_id?: number | string;
    translation_id?: number | string;
  };
  skips?: {
    opening?: { time: number; length: number } | null;
    ending?: { time: number; length: number } | null;
  };
};

/** Per-episode playback progress and watched state. */
export type EpisodeState = {
  position: number;
  duration: number;
  percent: number;
  updatedAt: number;
  /** Origin anime ID for franchise cross-referencing. */
  originAnimeId?: number;
  originEpisode?: string;
  completed?: boolean;
  completions?: number;
  completionHistory?: number[];
  rewatchArmed?: boolean;
  watchedSeconds?: number;
  manuallyCompleted?: boolean;
  manualPrevious?: {
    position: number;
    duration: number;
    percent: number;
    updatedAt: number;
    originAnimeId?: number;
    originEpisode?: string;
    completed?: boolean;
    completions?: number;
    completionHistory?: number[];
    rewatchArmed?: boolean;
    watchedSeconds?: number;
  };
};

/** Overall watch progress for a single anime title. */
export type AnimeProgress = {
  /** Human-readable metadata only. Progress lookup still uses the numeric anime ID. */
  title?: string;
  episode: string;
  dub: string;
  episodes: Record<string, EpisodeState>;
  totalEpisodes?: number;
  totalDuration?: number;
  season?: number;
  seasonLabel?: string;
  originAnimeId?: number;
  originEpisode?: string;
};

/** Map of anime ID to its corresponding progress record. */
export type Progress = Record<number, AnimeProgress>;

/** User-defined folder / category collection. */
export type Folder = { id: string; name: string; animeIds: number[]; notes?: Record<number, string> };

/** Tracked anime entry for new episode notifications. */
export type Tracker = {
  animeId: number;
  animeIds?: number[];
  title: string;
  knownEpisodes: number;
  knownEpisodeKeys?: string[];
  pendingEpisodeKeys?: string[];
  newEpisodes: number;
  /** Monotonic baseline across every dubbing, used for availability hints. */
  knownAnyEpisodeKeys?: string[];
  /** New episodes that exist, but not yet in the selected dubbing(s). */
  pendingOtherDubEpisodeKeys?: string[];
  otherDubEpisodes?: number;
  dubs?: string[];
  lastCheckedAt?: number;
  /** Detection time of the newest still-unacknowledged release. */
  lastNewEpisodeAt?: number;
};

/** Position of the UI action toolbar. */
export type ToolbarPosition = "top" | "bottom" | "left" | "right";

/** User player preferences and customization parameters. */
export type PlayerPrefs = {
  autoSkipOpening: boolean;
  autoSkipEnding: boolean;
  autoNext: boolean;
  autoPlayResume: boolean;
  autoScrollPlayer: boolean;
  homeEpisodePreview: boolean;
  homePreviewMode: "screenshots" | "poster";
  playerEpisodeCarousel: boolean;
  episodeHoverPreview: boolean;
  watchedEpisodeColor: string;
  interfaceFontScale: number;
  headingFontScale: number;
  posterScale: number;
  previewScale: number;
  watchPartyEnabled: boolean;
  watchPartyServer: string;
  watchPartyName: string;
  watchPartyMode: "follow" | "free";
  watchPartyRoomMode: "host" | "shared";
  watchPartyDubMode: "own" | "suggest" | "follow";
  watchPartyPanelPosition: "top" | "bottom" | "overlay";
  watchPartyAutoCatchUp: boolean;
};

/** Real-time playback synchronization payload for Watch Party. */
export type PartyPlayback = {
  animeId: number;
  season: number;
  episode: string;
  dub: string;
  player: string;
  position: number;
  duration: number;
  playing: boolean;
  updatedAt: number;
  sentAt?: number;
};

/** Connected room participant in Watch Party. */
export type PartyParticipant = {
  id: string;
  name: string;
  role: "host" | "guest";
  mode: "follow" | "free";
  playback?: PartyPlayback;
  buffering?: boolean;
  online: boolean;
};

/** Complete Watch Party room state. */
export type PartyState = {
  protocol?: number;
  roomId: string;
  roomMode: "host" | "shared";
  playback: PartyPlayback | null;
  participants: PartyParticipant[];
  lastControllerId?: string;
  lastAction?: { type: string; seq: number };
};

/** Metadata attributes for anime card rendering. */
export type CardMeta = {
  familyCount: number;
  seasonCount: number;
  movieCount: number;
  episodes: number;
  durationMin: number;
  durationMax: number;
  status: { label: string; kind: string };
};

/** Color theme definition. */
export type Theme = { name: string; accent: string; background: string };

/** Grouping of anime entries into a season or movie collection. */
export type SeasonGroup = { number: number; entries: Anime[]; label?: string; kind?: "season" | "movie" | "special" };

/** Release schedule information entry. */
export type ScheduleEntry = { anime_id: number; episodes?: { aired?: number; count?: number; next_date?: number; prev_date?: number } };

/** Full snapshot of user preferences, progress, and collections. */
export type ConfigSnapshot = {
  version: number;
  name: string;
  createdAt: string;
  favorites: number[];
  folders: Folder[];
  progress: Progress;
  /** Readability aid for exported JSON; application logic never depends on it. */
  animeTitles?: Record<number, string>;
  tracked: Tracker[];
  theme: Theme;
  toolbar: ToolbarPosition;
  playerPrefs?: PlayerPrefs;
  historyClearedAt?: number;
  historyEnabled?: boolean;
  libraryExpanded?: boolean;
  watchingExpanded?: boolean;
  historyExpanded?: boolean;
  watchingHidden?: number[];
};

/** Storage profile container. */
export type ConfigProfile = {
  id: string;
  name: string;
  snapshot: ConfigSnapshot;
  [key: string]: unknown;
};

/** Root storage document structure. */
export type StorageDocument = {
  schemaVersion: number;
  updatedAt: string;
  activeProfile: string;
  profiles: ConfigProfile[];
  [key: string]: unknown;
};

/** UI save status state. */
export type SaveStatus = { state: "loading" | "saving" | "saved" | "error"; at?: number };

/** Network API synchronization status state. */
export type ApiStatus = {
  state: "idle" | "updating" | "updated" | "error";
  at?: number;
  pingMs?: number;
  downlinkMbps?: number;
};

/** Props passed to Watch / Player page view. */
export type WatchProps = {
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
  onProgress: (
    value: AnimeProgress,
    originEpisodeKey?: string | string[],
    changedEpisodeKey?: string | string[],
  ) => void;
  onPlayerPrefsChange: (prefs: PlayerPrefs) => void;
  onFolders: () => void;
  tracker?: Tracker;
  onTrack: (count: number, dubs: string[], ids: number[], title: string) => void;
  onUntrack: () => void;
  folderPicker: Anime | null;
  folders: Folder[];
  toggleFolder: (folder: Folder, id: number) => void;
  createFolder: () => unknown;
  closePicker: () => void;
};
