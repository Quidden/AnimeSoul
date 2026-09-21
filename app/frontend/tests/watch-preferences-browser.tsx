// Run Vite and open /tests/watch-preferences-browser.html on a test origin.
// Exercise the real Watch effects with delayed access and incomplete dubbings.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Watch } from "../src/components/Player";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K } from "../src/lib/settings";
import type { Anime, PlayerPrefs, Video } from "../src/lib/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
HTMLMediaElement.prototype.load = noop;
HTMLMediaElement.prototype.pause = noop;
HTMLMediaElement.prototype.play = () => Promise.resolve();

const originalPrefs = localStorage.getItem(K.playerPrefs);
const originalFetch = window.fetch;
let anime: Anime;
let accessReady = false;
let releaseAccess: () => void = noop;
let accessGate = Promise.resolve();
const requests: string[] = [];
const videos: Video[] = [
  { video_id: 1, number: "1", iframe_url: "about:blank", data: { dubbing: "Favourite", player: "Kodik" } },
  { video_id: 2, number: "1", iframe_url: "about:blank", data: { dubbing: "Available", player: "Kodik" } },
  { video_id: 3, number: "2", iframe_url: "about:blank", data: { dubbing: "Available", player: "Kodik" } },
  { video_id: 4, number: "2", iframe_url: "about:blank", data: { dubbing: "Subtitles", player: "Kodik", translation_type: "subtitles" } },
];
window.fetch = async input => {
  const url = new URL(String(input), location.href);
  requests.push(url.href);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.pathname === "/api/downloads/settings") {
    await accessGate;
    return json({ kodikPublicKeyConfigured: accessReady, kodikPrivateKeyConfigured: accessReady });
  }
  if (url.pathname === "/api/downloads/jobs") return json({ jobs: [] });
  if (url.pathname.startsWith("/api/downloads/anime/")) return json({ anime: null });
  if (url.pathname === "/api/yummy") {
    const mode = url.searchParams.get("mode");
    if (mode === "videos") return json({ videos });
    if (mode === "schedule") return json({ schedule: [] });
    return json({ anime: [{ ...anime, viewing_order: [anime] }] });
  }
  // No actual provider, credentials, media or tracking service is contacted.
  return json({ detail: "Fixture stream unavailable" }, 503);
};

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function select(label: string) {
  const element = document.querySelector<HTMLSelectElement>(`#fixture select[aria-label="${label}"]`);
  expect(element, `Missing select: ${label}`);
  return element;
}
async function until(check: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (check()) return;
  }
  throw new Error(message);
}
function pass(message: string) {
  const item = document.createElement("li");
  item.textContent = `PASS: ${message}`;
  document.querySelector("#results")!.append(item);
}
let root: ReturnType<typeof createRoot> | undefined;
async function mount(id: number, newEpisodeRequested = false, titlePlayer = "AnimeSoul", seed = true) {
  if (root) await act(async () => root!.unmount());
  anime = { anime_id: id, title: `Preference fixture ${id}`, type: { name: "TV", alias: "tv" } };
  accessReady = false;
  accessGate = new Promise<void>(resolve => { releaseAccess = resolve; });
  if (seed) localStorage.setItem(K.playerPrefs, JSON.stringify({
    ...DEFAULT_PLAYER_PREFS, preferredDubbing: "Favourite", favoriteDubbings: ["Subtitles", "Favourite"],
    titlePlayers: { [id]: titlePlayer }, dubbingPreferenceVersion: 2,
    watchPartyEnabled: false, autoScrollPlayer: false, episodeHoverPreview: false, customPlayerToolbarVisible: true,
  }));
  root = createRoot(document.querySelector("#fixture")!);
  await act(async () => root!.render(<Watch
    header={null} anime={anime} resumeRequested={false} newEpisodeRequested={newEpisodeRequested}
    favorite={false} onFavorite={noop} onBack={noop} onLibrary={noop} onGenre={noop}
    onRatingChange={noop} onProgress={noop} onPlayerPrefsChange={noop} onFolders={noop}
    tracker={{ animeId: id, title: anime.title, knownEpisodes: 2, newEpisodes: 1, pendingEpisodeKeys: [`${id}:2`] }}
    onTrack={noop} onUntrack={noop} folderPicker={null} folders={[]}
    toggleFolder={noop} createFolder={noop} closePicker={noop}
  />));
  await until(() => Boolean(document.querySelector('select[aria-label="Источник"] option')), "Videos did not load");
}
async function grantAccess() {
  await act(async () => { accessReady = true; releaseAccess(); });
  await until(() => Boolean(document.querySelector('select[aria-label="Источник"] option[value="AnimeSoul"]')), "Access did not become ready");
}
const prefs = () => JSON.parse(localStorage.getItem(K.playerPrefs)!) as PlayerPrefs;

async function run() {
  await mount(91001);
  expect(select("Источник").value === "Kodik", "Pending access needs a temporary fallback");
  await grantAccess();
  expect(select("Источник").value === "AnimeSoul", "Saved AnimeSoul choice must recover after delayed access");
  pass("Saved AnimeSoul choice survives delayed access");

  await until(() => [...document.querySelectorAll("button")].some(button => button.textContent === "Открыть плеер Kodik"), "Missing fallback button");
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "Открыть плеер Kodik")!.click());
  expect(select("Источник").value === "Kodik", "Fallback should open Kodik now");
  expect(prefs().titlePlayers[91001] === "AnimeSoul", "Temporary fallback must not replace saved preference");
  await mount(91001, false, "AnimeSoul", false);
  await grantAccess();
  expect(select("Источник").value === "AnimeSoul", "Reopening must restore saved player");
  pass("Fallback is temporary and reopening restores AnimeSoul");

  await act(async () => {
    select("Источник").value = "Kodik";
    select("Источник").dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(prefs().titlePlayers[91001] === "Kodik", "Explicit player choice must persist");
  await mount(91001, false, "Kodik", false);
  await grantAccess();
  expect(select("Источник").value === "Kodik", "Explicit Kodik choice must survive reopening and access check");
  pass("Explicit Kodik selection persists across reopening");

  await mount(91002, true);
  await until(() => select("Серия").value === "2", "New episode did not open");
  expect(select("Озвучка").value === "Available", "New episode must exclude missing favourite and subtitles");
  expect(requests.some(value => value.includes("id=91002") && value.includes("refresh=true")), "New episode must refresh cached availability");
  await grantAccess();
  expect(select("Источник").value === "AnimeSoul", "New episode must also recover saved player after delayed access");
  expect(prefs().preferredDubbing === "Favourite", "Fallback dubbing must not overwrite favourite");
  pass("New release uses an available voice and keeps saved preferences");

  await mount(91003, false, "Kodik");
  expect(select("Озвучка").value === "Favourite", "Episode 1 should use favourite");
  const next = document.querySelector<HTMLButtonElement>('.episode-entry[aria-label$="серия 2"]');
  expect(next, "Missing episode 2 card");
  await act(async () => next.click());
  expect(select("Серия").value === "2", "Episode card must keep the requested episode");
  expect(select("Озвучка").value === "Available", "Episode card must resolve an available voice without reloading catalog");
  pass("Episode navigation rechecks voice availability in an already loaded season");
}

void run().then(() => {
  document.querySelector("#status")!.textContent = "All 5 watch preference regressions passed";
}).catch(error => {
  document.querySelector("#status")!.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
}).finally(async () => {
  releaseAccess();
  if (root) await act(async () => root!.unmount());
  window.fetch = originalFetch;
  if (originalPrefs === null) localStorage.removeItem(K.playerPrefs);
  else localStorage.setItem(K.playerPrefs, originalPrefs);
});
