import type { KodikDirectSource } from "./kodikStream";

export type CastState = {
  available: boolean;
  connected: boolean;
  suspended: boolean;
  device: string;
  id: string;
  pendingId: string;
  position: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  finished: boolean;
  volume: number;
  error: string;
};

export const EMPTY_CAST_STATE: CastState = {
  available: false, connected: false, suspended: false, device: "", id: "", pendingId: "",
  position: 0, duration: 0, playing: false, buffering: false, finished: false, volume: 1, error: "",
};

export function castBridge() {
  return typeof window === "undefined" ? undefined
    : (window as Window & { AnimeSoulCast?: { postMessage: (message: string) => void } }).AnimeSoulCast;
}

export function sendCastCommand(action: string, data: Record<string, unknown> = {}) {
  const bridge = castBridge();
  if (!bridge) return false;
  try { bridge.postMessage(JSON.stringify({ ...data, action })); return true; }
  catch { return false; }
}

/** Cast fetches the URL itself: loopback and downloaded media are not reachable. */
export function castMediaSource(source?: KodikDirectSource, localPlayback = false) {
  if (!source || localPlayback) return null;
  try {
    const url = new URL(source.src);
    if (url.protocol !== "https:" || url.username || url.password
      || url.hostname === "localhost" || url.hostname.startsWith("127.")
      || url.hostname === "[::1]") return null;
    const type = source.type.toLowerCase();
    if (type.includes("hls") || type.includes("mpegurl") || url.pathname.endsWith(".m3u8")) {
      return { url: url.href, type: "application/x-mpegURL" };
    }
    if (type === "video/mp4" || url.pathname.endsWith(".mp4")) return { url: url.href, type: "video/mp4" };
    return null;
  } catch { return null; }
}

export function castOwnsPlayback(state: CastState, id: string) {
  return Boolean(id && state.id === id && (!state.pendingId || state.pendingId === id));
}

// The parent player still exposes an HTMLVideoElement for iframe/local parity.
// Route its imperative commands to Cast without mutating browser DOM methods.
const remoteControls = new WeakMap<HTMLVideoElement, (method: string, seconds?: number) => boolean>();
export function registerCastControl(video: HTMLVideoElement, control: (method: string, seconds?: number) => boolean) {
  remoteControls.set(video, control);
  return () => { remoteControls.delete(video); };
}
export function commandCastVideo(video: HTMLVideoElement, method: string, seconds?: number) {
  return remoteControls.get(video)?.(method, seconds) ?? false;
}
