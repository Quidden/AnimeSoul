import type { ReactNode } from "react";

export type AnimeScreenshot = {
  time?: number;
  id?: number;
  episode?: string;
  sizes?: { small?: string; full?: string };
};

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
  data: { dubbing: string; player: string };
  skips?: {
    opening?: { time: number; length: number } | null;
    ending?: { time: number; length: number } | null;
  };
};

export type EpisodeState = {
  position: number;
  duration: number;
  percent: number;
  updatedAt: number;
  completed?: boolean;
  completions?: number;
  rewatchArmed?: boolean;
  watchedSeconds?: number;
};

export type AnimeProgress = {
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

export type Progress = Record<number, AnimeProgress>;
export type Folder = { id: string; name: string; animeIds: number[]; notes?: Record<number, string> };
export type Tracker = {
  animeId: number;
  animeIds?: number[];
  title: string;
  knownEpisodes: number;
  knownEpisodeKeys?: string[];
  pendingEpisodeKeys?: string[];
  newEpisodes: number;
  dubs?: string[];
  lastCheckedAt?: number;
};

export type ToolbarPosition = "top" | "bottom" | "left" | "right";
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
export type PartyParticipant = {
  id: string;
  name: string;
  role: "host" | "guest";
  mode: "follow" | "free";
  playback?: PartyPlayback;
  buffering?: boolean;
  online: boolean;
};
export type PartyState = {
  protocol?: number;
  roomId: string;
  roomMode: "host" | "shared";
  playback: PartyPlayback | null;
  participants: PartyParticipant[];
  lastControllerId?: string;
  lastAction?: { type: string; seq: number };
};

export type CardMeta = {
  familyCount: number;
  seasonCount: number;
  movieCount: number;
  episodes: number;
  durationMin: number;
  durationMax: number;
  status: { label: string; kind: string };
};
export type Theme = { name: string; accent: string; background: string };
export type SeasonGroup = { number: number; entries: Anime[]; label?: string; kind?: "season" | "movie" | "special" };
export type ScheduleEntry = { anime_id: number; episodes?: { aired?: number; count?: number; next_date?: number; prev_date?: number } };
export type ConfigSnapshot = {
  version: number;
  name: string;
  createdAt: string;
  favorites: number[];
  folders: Folder[];
  progress: Progress;
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
export type ConfigProfile = { id: string; name: string; snapshot: ConfigSnapshot };
export type StorageDocument = { schemaVersion: number; updatedAt: string; activeProfile: string; profiles: ConfigProfile[] };
export type SaveStatus = { state: "loading" | "saving" | "saved" | "error"; at?: number };
export type ApiStatus = {
  state: "idle" | "updating" | "updated" | "error";
  at?: number;
  pingMs?: number;
  downlinkMbps?: number;
};

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
  onProgress: (value: AnimeProgress, originEpisodeKey?: string) => void;
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
