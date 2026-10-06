// Run Vite and open /tests/loading-browser.html on a test origin.
// All provider and media boundaries are fixtures; the React effects are real.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SeasonList } from "../src/features/player/SeasonList";
import { AnimeTrailer } from "../src/features/player/AnimeTrailer";
import { Watch } from "../src/components/Player";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K } from "../src/lib/settings";
import { animeRoute, navigateTo } from "../src/features/navigation/routes";
import type { Anime, Video } from "../src/lib/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
HTMLMediaElement.prototype.load = noop;
HTMLMediaElement.prototype.pause = noop;
HTMLMediaElement.prototype.play = () => Promise.resolve();
const originalFetch = window.fetch;
const originalMedia = window.matchMedia;
const originalPrefs = localStorage.getItem(K.playerPrefs);
const root = createRoot(document.querySelector("#fixture")!);
const json = (payload: unknown) => new Response(JSON.stringify(payload));
const video = (id: number): Video => ({video_id: id, number: "1", iframe_url: "about:blank", data: {dubbing: "A", player: "Kodik"}});
function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (check()) return;
  }
  throw new Error(message);
}
function pass(message: string) {
  const row = document.createElement("li");
  row.textContent = `PASS: ${message}`;
  document.querySelector("#results")!.append(row);
}

async function run() {
  // Use the classic desktop layout, where several seasons can be expanded.
  window.matchMedia = query => ({...originalMedia(query), matches: false, addEventListener: noop, removeEventListener: noop});
  const props = {
    seasons: [{number: 1, entries: [{anime_id: 98001, title: "Demo"}]}],
    seasonVideos: {1: [{...video(1), contentKind: "OVA" as const}, {...video(2), duration: 1440}, {...video(3), number: "2", duration: 1500}]},
    schedule: {}, collapsedSeasons: [] as number[], selectedSeason: 1, selectedEpisode: "1",
    previewAnimeById: {}, episodeHoverPreview: false, compactEpisodeList: false, newEpisodeKeys: new Set<string>(),
    onToggleSeason: noop, onToggleSeasonWatched: noop, onChooseEpisode: noop, onToggleWatched: noop, onSeasonRatingChange: noop, onEpisodeRatingChange: noop,
  };
  await act(async () => root.render(<SeasonList {...props} />));
  expect(document.querySelectorAll(".episode-card-shell").length === 2, "Multiple translations must produce only two cards");
  expect(document.querySelector(".episode-entry")?.textContent?.includes("OVA 1"), "Keep the first source's content label");
  expect(document.querySelector(".episode-entry")?.textContent?.includes("24 мин"), "Find the first available duration across translations");
  await act(async () => root.render(<SeasonList {...props} collapsedSeasons={[1]} />));
  expect(!document.querySelector(".episode-card-shell"), "Collapsed seasons must not mount episode cards");
  expect(document.querySelector(".season-summary")?.textContent?.includes("0 из 2"), "Collapsed season keeps its total");
  pass("Episode translations and duration stay correct; collapsed cards are unmounted");

  window.matchMedia = originalMedia;
  const titles: Anime[] = [98011, 98012].map(anime_id => ({anime_id, title: `Demo ${anime_id}`, remote_ids: {shikimori_id: anime_id}}));
  let releaseSibling = noop;
  const sibling = new Promise<void>(resolve => { releaseSibling = resolve; });
  window.fetch = async input => {
    const url = new URL(String(input), location.href);
    if (Number(url.searchParams.get("id")) === 98012) await sibling;
    return json(url.searchParams.get("mode") === "shikimori"
      ? {metadata: {videos: []}}
      : {trailers: [{url: "https://youtu.be/abcdefghijk"}]});
  };
  try {
    await act(async () => root.render(<AnimeTrailer animeId={98011} seasons={titles.map((entry, index) => ({number: index + 1, entries: [entry]}))} />));
    await until(() => Boolean(document.querySelector(".watch-trailer iframe")), "Current trailer waits for a blocked sibling");
    pass("Current trailer appears while another season's request is still blocked");
  } finally { releaseSibling(); }

  await act(async () => root.render(null));
  const family: Anime[] = [98101, 98102, 98103, 98104].map((anime_id, index) => ({anime_id, title: `Loading ${index + 1}`, type: {name: "TV", alias: "tv"}, data: {index}}));
  const requested: number[] = [];
  let releaseSlow = noop;
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  window.fetch = async input => {
    const url = new URL(String(input), location.href);
    if (url.pathname === "/api/downloads/settings") return json({});
    if (url.pathname === "/api/downloads/jobs") return json({jobs: []});
    if (url.pathname.startsWith("/api/downloads/anime/")) return json({anime: null});
    if (url.pathname === "/api/yummy") {
      const mode = url.searchParams.get("mode");
      if (mode === "videos") {
        const id = Number(url.searchParams.get("id"));
        requested.push(id);
        if (id === 98102) await slow;
        return json({videos: [video(id)]});
      }
      if (mode === "details") return json({anime: family.map(entry => ({...entry, viewing_order: family}))});
      if (mode === "schedule") return json({schedule: []});
      if (mode === "trailers") return json({trailers: []});
    }
    return json({});
  };
  localStorage.setItem(K.playerPrefs, JSON.stringify({...DEFAULT_PLAYER_PREFS, titlePlayers: {[98101]: "Kodik"}, watchPartyEnabled: false, episodeHoverPreview: false, autoScrollPlayer: false}));
  try {
    await act(async () => root.render(<Watch header={null} anime={family[0]} resumeRequested={false} newEpisodeRequested={false}
      favorite={false} onFavorite={noop} onBack={noop} onLibrary={noop} onGenre={noop} onRatingChange={noop} onProgress={noop}
      onPlayerPrefsChange={noop} onFolders={noop} onTrack={noop} onUntrack={noop} folderPicker={null} folders={[]}
      toggleFolder={noop} createFolder={noop} closePicker={noop} />));
    await until(() => requested.includes(98102), "Background season never started");
    expect(!requested.includes(98103), "Background queue should not saturate providers");
    await act(async () => navigateTo(animeRoute(98101, 3, "1")));
    await until(() => requested.includes(98103), "Selected season waits for a slow background season");
    await until(() => Boolean(document.querySelector('.episode-entry[aria-label*="Сезон 3"]')), "Selected season did not become playable");
    const seasonOne = document.querySelector('.beta-season-nav button');
    if (seasonOne instanceof HTMLButtonElement) {
      await act(async () => seasonOne.click());
      expect(document.querySelector('.episode-entry[aria-label*="Сезон 1"]'), "Changing priority erased an already loaded season");
    }
    pass("Selected season bypasses a blocked background request and keeps loaded episodes");
  } finally { releaseSlow(); }
}

void run().then(() => {
  document.querySelector("#status")!.textContent = "All 3 loading regressions passed";
}).catch(error => {
  document.querySelector("#status")!.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
}).finally(async () => {
  await act(async () => root.unmount());
  window.fetch = originalFetch;
  window.matchMedia = originalMedia;
  if (originalPrefs === null) localStorage.removeItem(K.playerPrefs);
  else localStorage.setItem(K.playerPrefs, originalPrefs);
});
