// Run Vite and open /tests/player-browser.html. This fixture exercises React
// events, focus and computed cursor styles without a network/media dependency.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnimeSoulPlayer } from "../src/features/player/AnimeSoulPlayer";
import type { PlayerMenu } from "../src/features/player/AnimeSoulPlayerMenus";
import type { KodikStreamRequest } from "../src/lib/kodikStream";
import "../src/styles/custom-player.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type MediaState = { paused: boolean; currentTime: number; playbackRate: number; src: string; readyState: number };
const mediaStates = new WeakMap<HTMLMediaElement, MediaState>();
function media(element: HTMLMediaElement) {
  let state = mediaStates.get(element);
  if (!state) {
    state = { paused: true, currentTime: 0, playbackRate: 1, src: "", readyState: 0 };
    mediaStates.set(element, state);
  }
  return state;
}

// Replace only the decoder boundary. The component, DOM and React event
// handlers are real; load() resets the decoder as a new resource would.
for (const property of ["paused", "currentTime", "playbackRate", "src", "readyState"] as const) {
  Object.defineProperty(HTMLMediaElement.prototype, property, {
    configurable: true,
    get(this: HTMLMediaElement) { return media(this)[property]; },
    set(this: HTMLMediaElement, value: never) { media(this)[property] = value; },
  });
}
Object.defineProperties(HTMLMediaElement.prototype, {
  duration: { configurable: true, get: () => 120 },
  currentSrc: { configurable: true, get(this: HTMLMediaElement) { return media(this).src; } },
  play: { configurable: true, value(this: HTMLMediaElement) {
    if (media(this).paused) {
      media(this).paused = false;
      this.dispatchEvent(new Event("play"));
    }
    return Promise.resolve();
  } },
  pause: { configurable: true, value(this: HTMLMediaElement) {
    if (!media(this).paused) {
      media(this).paused = true;
      this.dispatchEvent(new Event("pause"));
    }
  } },
  load: { configurable: true, value(this: HTMLMediaElement) {
    this.pause();
    Object.assign(media(this), { currentTime: 0, playbackRate: 1, readyState: 0 });
  } },
});

// Advance the inactivity timeout deterministically, keeping React's scheduler
// and short gesture timers on the browser clock.
const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const idleTimers = new Map<number, () => void>();
let timerId = -1;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== 2600 || typeof handler !== "function") return nativeSetTimeout(handler, delay, ...args);
  const id = timerId--;
  idleTimers.set(id, () => handler(...args));
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = id => { idleTimers.delete(Number(id)); nativeClearTimeout(id); };

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(`#fixture ${selector}`);
  expect(element, `Missing element: ${selector}`);
  return element;
}
const video = () => find<HTMLVideoElement>(".animesoul-player-video");
const shell = () => find(".animesoul-player");
const shown = () => shell().classList.contains("controls-visible");
const change = (label: string, value: string) => act(async () => {
  const select = find<HTMLSelectElement>(`select[aria-label="${label}"]`);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
const click = (selector: string) => act(async () => find<HTMLElement>(selector).click());
const pointer = (target: EventTarget, type = "pointermove", extra: PointerEventInit = {}) => act(async () => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", clientX: 200, ...extra }));
});
const expireIdle = () => act(async () => {
  const callbacks = [...idleTimers.values()];
  idleTimers.clear();
  callbacks.forEach(callback => callback());
});
const ready = () => act(async () => {
  media(video()).readyState = 4;
  video().dispatchEvent(new Event("loadedmetadata"));
  video().dispatchEvent(new Event("canplay"));
});
const play = () => act(async () => { await video().play(); });
const pause = () => act(async () => video().pause());
const noop = () => undefined;
const menu: PlayerMenu = {
  dubbings: [], dubbing: "Test", onDubbingChange: noop,
  dubbingFavorite: false, onDubbingFavoriteToggle: noop,
  dubbingGloballyPreferred: false, onDubbingGloballyPreferredToggle: noop,
  seasons: [], season: "1", onSeasonChange: noop,
  episodes: [], episode: "1", onEpisodeChange: noop,
  sources: [], source: "test", onSourceChange: noop, subtitles: [],
  autoSkipOpening: false, onAutoSkipOpeningChange: noop,
  autoSkipEnding: false, onAutoSkipEndingChange: noop,
  autoNext: false, onAutoNextChange: noop,
  externalToolbarVisible: false, onExternalToolbarVisibleChange: noop,
};
const request: KodikStreamRequest = {
  videoId: 1, season: 1, episode: "1", dubbing: "Test", iframeUrl: "",
  directStream: {
    sources: [
      { quality: 720, src: "fixture:720.mp4", type: "video/mp4" },
      { quality: 480, src: "fixture:480.mp4", type: "video/mp4" },
    ],
    subtitles: [],
  },
};

const root = createRoot(document.getElementById("fixture")!);
let caseId = 0;
let failed = 0;
const renderPlayer = (nextRequest = request) => act(async () => {
  root.render(<AnimeSoulPlayer key={caseId} request={nextRequest}
    title="Regression fixture" seasonLabel="Season 1" episodeLabel={`Episode ${nextRequest.episode}`} menu={menu} />);
});
const waitForGesture = () => act(async () => { await new Promise(resolve => nativeSetTimeout(resolve, 500)); });
async function test(name: string, run: () => Promise<void>) {
  const row = document.createElement("li");
  document.getElementById("results")!.append(row);
  try {
    caseId++;
    await renderPlayer();
    await ready();
    await run();
    row.textContent = `PASS — ${name}`;
  } catch (error) {
    failed++;
    row.textContent = `FAIL — ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
  await act(async () => root.render(null));
}

await test("Cursor hides with the interface and returns on movement and pause", async () => {
  await play();
  await expireIdle();
  expect(!shown(), "Interface did not hide");
  expect(getComputedStyle(video()).cursor === "none", "Cursor remains over the video");
  expect(getComputedStyle(shell()).cursor === "none", "Cursor remains over the player shell");
  await pointer(video());
  expect(shown() && getComputedStyle(video()).cursor !== "none", "Movement did not restore controls/cursor");
  await expireIdle();
  await pause();
  expect(shown() && getComputedStyle(video()).cursor !== "none", "Pause did not restore controls/cursor");
});

await test("Settings remain visible and auto-hide restarts after closing", async () => {
  await play();
  await click("button[aria-label='Настройки плеера']");
  await expireIdle();
  expect(shown(), "Open settings lost controls");
  await click("button[aria-label='Закрыть настройки']");
  await expireIdle();
  expect(!shown(), "Closing settings did not restart inactivity timeout");
});

await test("Timeline hover pins controls; leaving clears the hidden preview", async () => {
  await play();
  await pointer(find(".animesoul-player-timeline"));
  expect(find(".animesoul-player-timeline-preview").classList.contains("visible"), "Preview did not appear");
  await expireIdle();
  expect(shown(), "Controls disappeared during timeline hover");
  await pointer(video());
  await expireIdle();
  expect(!shown(), "Controls did not hide after leaving timeline");
  expect(!find(".animesoul-player-timeline-preview").classList.contains("visible"), "Hidden preview remained active");
});

await test("Dragging a control pins the interface until pointer release outside the player", async () => {
  await play();
  await pointer(find("input[aria-label='Позиция видео']"), "pointerdown", { buttons: 1 });
  await pointer(video());
  await expireIdle();
  expect(shown(), "Controls disappeared while dragging");
  await pointer(window, "pointerup");
  await expireIdle();
  expect(!shown(), "Pointer release did not rearm inactivity timeout");
});

await test("Keyboard focus keeps a control visible until focus leaves the player", async () => {
  await play();
  await act(async () => find<HTMLElement>("input[aria-label='Позиция видео']").focus());
  await expireIdle();
  expect(shown(), "Focused control became invisible");
  await act(async () => find<HTMLElement>("input[aria-label='Позиция видео']").blur());
  await expireIdle();
  expect(!shown(), "Focus leaving did not rearm inactivity timeout");
});

await test("Seeking with arrows prevents scrolling and reveals controls; modified keys are ignored", async () => {
  await play();
  await expireIdle();
  const key = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  await act(async () => { shell().dispatchEvent(key); });
  expect(video().currentTime === 10 && key.defaultPrevented, "Arrow seek allowed default page scrolling");
  expect(shown(), "Keyboard seek left the interface hidden");
  await act(async () => { shell().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true })); });
  expect(video().currentTime === 10, "Modified shortcut unexpectedly sought the video");
});

await test("Quality change preserves time, playback and speed; later canplay respects pause", async () => {
  await change("Скорость воспроизведения", "1.5");
  await play();
  video().currentTime = 35;
  const quality = find<HTMLSelectElement>("select[aria-label='Качество видео']").value;
  await change("Качество видео", quality === "720" ? "480" : "720");
  await ready();
  expect(video().currentTime === 35 && !video().paused, "Quality change lost time or playback");
  expect(video().playbackRate === 1.5, "Displayed speed differs from the decoder after load");
  await pause();
  video().currentTime = 50;
  await act(async () => { video().dispatchEvent(new Event("canplay")); });
  expect(video().paused, "A paused seek/buffer completion restarted playback");
  await act(async () => { video().dispatchEvent(new Event("loadedmetadata")); });
  expect(video().currentTime === 50, "Repeated metadata rewound to an obsolete resume position");
});

await test("A playback error keeps recovery controls and the cursor visible", async () => {
  await play();
  await expireIdle();
  await act(async () => { video().dispatchEvent(new Event("error")); });
  await expireIdle();
  expect(shown(), "Error controls were allowed to auto-hide");
  expect(getComputedStyle(video()).cursor !== "none", "Cursor hidden during error recovery");
});

await test("First touch on a hidden video reveals controls without pausing", async () => {
  await play();
  await expireIdle();
  await pointer(video(), "pointerdown", { pointerType: "touch" });
  await pointer(video(), "pointerup", { pointerType: "touch" });
  await click(".animesoul-player-video");
  await waitForGesture();
  expect(shown() && !video().paused, "First touch paused instead of revealing controls");
});

await test("A pending tap on the previous episode cannot pause the next one", async () => {
  await play();
  await click(".animesoul-player-video");
  await renderPlayer({ ...request, episode: "2" });
  await ready();
  await waitForGesture();
  expect(!video().paused, "An old single-tap callback paused the new episode");
  expect(video().currentTime === 0, "New episode inherited the old timestamp");
});

await test("A dubbing change ends temporary long-press speed", async () => {
  await change("Скорость воспроизведения", "1.5");
  await play();
  await pointer(video(), "pointerdown", { pointerType: "touch" });
  await waitForGesture();
  expect(video().playbackRate === 2, "Long press did not activate");
  await renderPlayer({ ...request, dubbing: "Second dubbing" });
  expect(video().playbackRate === 1.5, "Dubbing switch left the player stuck at 2x");
});

await test("A seamless dubbing change cannot arm a later unwanted autoplay", async () => {
  await play();
  video().currentTime = 35;
  await renderPlayer({ ...request, dubbing: "Second dubbing" });
  await pause();
  await act(async () => { video().dispatchEvent(new Event("canplay")); });
  expect(video().paused, "Buffering after a dubbing change cancelled the user's pause");
});

await act(async () => root.unmount());
window.setTimeout = nativeSetTimeout;
window.clearTimeout = nativeClearTimeout;
document.getElementById("status")!.textContent = `${caseId - failed}/${caseId} passed${failed ? `; ${failed} failed` : ""}`;
document.title = `${failed ? "FAIL" : "PASS"}: Player browser regressions`;
