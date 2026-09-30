import { useEffect } from "react";
import { DISCORD_FEATURE } from "./config";
export { DISCORD_FEATURE } from "./config";

const KEY = "animesoul:discord-device-v1";
const EVENT = "animesoul:discord-settings";
export type DiscordPreferences = {
  enabled: boolean; applicationId: string; logo: boolean; title: boolean;
  season: boolean; episode: boolean; layout: "title-first" | "episode-first";
  time: "off" | "elapsed" | "remaining" | "text"; paused: "show" | "hide"; idle: boolean;
};
export const DEFAULT_DISCORD: DiscordPreferences = {
  enabled: false, applicationId: "", logo: true, title: true, season: true, episode: true,
  layout: "title-first", time: "elapsed", paused: "show", idle: true,
};
export type DiscordPlayback = {
  title: string; season: string; episode: string; position: number; duration: number; playing: boolean;
};
export type DiscordStatus = { available: boolean; state: string; applicationId?: string };
type Bridge = { discord_presence: (payload?: unknown) => Promise<DiscordStatus> };
let playback: DiscordPlayback | null = null;
const session = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function readDiscordPreferences(): DiscordPreferences {
  try { return { ...DEFAULT_DISCORD, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULT_DISCORD }; }
}
export function saveDiscordPreferences(preferences: DiscordPreferences) {
  localStorage.setItem(KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event(EVENT));
}
function bridge(): Bridge | undefined {
  return (window as unknown as { pywebview?: { api?: Bridge } }).pywebview?.api;
}
async function request(payload?: unknown): Promise<DiscordStatus> {
  if (!DISCORD_FEATURE) return { available: false, state: "unsupported" };
  try {
    const desktop = bridge();
    if (desktop?.discord_presence) return await desktop.discord_presence(payload);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      return { available: false, state: "local_required" };
    }
    const response = await fetch(`/api/discord/${payload ? "presence" : "status"}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error("Discord bridge unavailable");
    return await response.json();
  } catch { return { available: false, state: "unavailable" }; }
}
export const discordStatus = () => request();

/** The only app-level hook; removing it stops all presence publication. */
export function useDiscordPresence() {
  useEffect(() => {
    if (!DISCORD_FEATURE) return;
    let sent = false;
    let busy = false;
    let disposed = false;
    const publish = async () => {
      if (busy || disposed) return;
      const preferences = readDiscordPreferences();
      if (!preferences.enabled && !sent) return;
      busy = true;
      await request({ session, preferences, playback });
      sent = preferences.enabled;
      busy = false;
    };
    const clear = () => {
      if (sent) void request({ session, preferences: { ...readDiscordPreferences(), enabled: false }, playback: null });
    };
    void publish();
    const timer = window.setInterval(() => void publish(), 5000);
    window.addEventListener(EVENT, publish);
    window.addEventListener("storage", publish);
    window.addEventListener("pywebviewready", publish);
    window.addEventListener("pagehide", clear);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(EVENT, publish);
      window.removeEventListener("storage", publish);
      window.removeEventListener("pywebviewready", publish);
      window.removeEventListener("pagehide", clear);
      clear();
    };
  }, []);
}

export function useDiscordPlayback(value: DiscordPlayback | null) {
  useEffect(() => { playback = value; });
  useEffect(() => () => { playback = null; }, []);
}
