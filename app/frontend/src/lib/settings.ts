import type { PlayerPrefs, Theme } from "./types";

export const STORAGE_KEYS = {
  favorites: "animesoul:favorites",
  folders: "animesoul:folders",
  progress: "animesoul:progress-v2",
  tracked: "animesoul:tracked",
  theme: "animesoul:theme",
  toolbar: "animesoul:toolbar",
  playerPrefs: "animesoul:player-prefs",
  profiles: "animesoul:profiles",
  activeProfile: "animesoul:active-profile",
  historyClearedAt: "animesoul:history-cleared-at",
  historyEnabled: "animesoul:history-enabled",
  libraryExpanded: "animesoul:section-library-expanded",
  watchingExpanded: "animesoul:section-watching-expanded",
  historyExpanded: "animesoul:section-history-expanded",
  watchingHidden: "animesoul:watching-hidden",
} as const;

export const THEMES: Theme[] = [
  { name: "Аметист", accent: "#9a78ff", background: "#09080d" },
  { name: "Сакура", accent: "#f078aa", background: "#10090e" },
  { name: "Океан", accent: "#45b8cf", background: "#071014" },
  { name: "Манго", accent: "#f0a348", background: "#100d08" },
  { name: "Светлая", accent: "#7655d9", background: "#f4f1f7" },
];

export const SCHEMA_VERSION = 3;
export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  autoSkipOpening: false,
  autoSkipEnding: false,
  autoNext: true,
  autoPlayResume: true,
  autoScrollPlayer: true,
  homeEpisodePreview: true,
  homePreviewMode: "poster",
  playerEpisodeCarousel: true,
  episodeHoverPreview: true,
  watchedEpisodeColor: "#9a78ff",
  interfaceFontScale: 1,
  headingFontScale: 1,
  posterScale: 1,
  previewScale: 1,
  watchPartyEnabled: false,
  // The FastAPI build serves storage and watch-party endpoints on one origin.
  watchPartyServer: typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000",
  watchPartyName: "Участник",
  watchPartyMode: "follow",
  watchPartyRoomMode: "host",
  watchPartyDubMode: "suggest",
  watchPartyPanelPosition: "bottom",
  watchPartyAutoCatchUp: true,
};
