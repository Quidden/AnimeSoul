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
  rating?: AnimeApiRating;
  genres?: { title: string; alias: string }[];
  type?: { name?: string; alias?: string; shortname?: string; value?: number };
  data?: { index?: number; text?: string };
  views?: number;
  anime_status?: { value?: number; title?: string; alias?: string };
  viewing_order?: Anime[];
  remote_ids?: {
    shikimori_id?: number | string;
    kp_id?: number | string;
    imdb_id?: number | string;
    worldart_id?: number | string;
    worldart_type?: string;
    kodik_id?: number | string;
  };
  franchiseCount?: number;
  franchiseEntries?: Anime[];
  random_screenshots?: AnimeScreenshot[];
};

/** Ratings returned by YummyAnime and its upstream catalog sources. */
export type AnimeApiRating = {
  average?: number;
  counters?: number;
  kp_rating?: number;
  anidub_rating?: number;
  myanimelist_rating?: number;
  worldart_rating?: number;
  shikimori_rating?: number;
  imdb_rating?: number;
  [source: string]: number | undefined;
};

/** User scores for one anime/franchise, including its seasons and episodes. */
export type AnimeUserRatings = {
  title?: string;
  anime?: number;
  seasons: Record<string, number>;
  episodes: Record<string, number>;
  updatedAt?: number;
};

/** Map of catalog anime ID to the user's rating tree. */
export type UserRatings = Record<number, AnimeUserRatings>;

/** One aggregate score returned by the shared AnimeSoul rating service. */
export type CommunityRatingSummary = {
  average: number;
  count: number;
};

/** Anonymous aggregate for an anime and its season/episode rating tree. */
export type CommunityAnimeRating = {
  animeId: number;
  title?: string;
  anime?: CommunityRatingSummary | null;
  seasons: Record<string, CommunityRatingSummary>;
  episodes: Record<string, CommunityRatingSummary>;
  updatedAt?: number;
};

/** Map of anime ID to shared ratings published to this AnimeSoul server. */
export type CommunityRatings = Record<number, CommunityAnimeRating>;

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
    translation_type?: string;
  };
  skips?: {
    opening?: { time: number; length: number } | null;
    ending?: { time: number; length: number } | null;
  };
  /** A fully downloaded local copy. It is preferred outside Watch Party. */
  offline?: {
    episodeId: string;
    quality: number;
    mediaUrl: string;
    previewUrl?: string;
  };
};

/** Normalized trailer source used by the full-screen home hero. */
export type HeroTrailer = {
  url: string;
  kind: "video" | "embed";
  title?: string;
  poster?: string;
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
  /** Voice/provider used for this exact playback position. */
  dub?: string;
  player?: string;
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
    dub?: string;
    player?: string;
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
  toolbarIconOnly: boolean;
  /** Keep the legacy toolbar around the custom AnimeSoul player. */
  customPlayerToolbarVisible: boolean;
  watchedEpisodeColor: string;
  interfaceFontScale: number;
  headingFontScale: number;
  posterScale: number;
  previewScale: number;
  /** Ordered global voice favourites used as the fallback preference list. */
  favoriteDubbings: string[];
  /** Explicit default voice selected for individual anime titles. */
  titleDubbings: Record<string, string>;
  /** Player/provider selected for individual anime titles. */
  titlePlayers: Record<string, string>;
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
  ratings: UserRatings;
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
