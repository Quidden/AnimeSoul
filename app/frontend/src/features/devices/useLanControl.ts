import { useEffect, useRef } from "react";
import type { Anime } from "../../lib/types";
import { lanRequest, type LanCommand, type LanPlayer } from "./api";

type Bridge = { state: () => LanPlayer; command: (command: LanCommand) => void | Promise<void> };
let playerBridge: Bridge | null = null;

export function useLanPlayer(state: LanPlayer, command: Bridge["command"]) {
  const latest = useRef({ state, command });
  latest.current = { state, command };
  useEffect(() => {
    const bridge = { state: () => latest.current.state, command: (value: LanCommand) => latest.current.command(value) };
    playerBridge = bridge;
    return () => { if (playerBridge === bridge) playerBridge = null; };
  }, []);
}

export function useLanControl(catalog: Anime[], openAnime: (anime: Anime, resume?: boolean) => void) {
  const latest = useRef({ catalog, openAnime });
  latest.current = { catalog, openAnime };
  useEffect(() => {
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const state = await lanRequest<{ enabled: boolean }>("/status", "GET", undefined, controller.signal);
        if (state.enabled && !stop) {
          const runtime = await import("./lanControlRuntime");
          if (!controller.signal.aborted) stop = runtime.startLanControl(() => playerBridge, () => latest.current);
        } else if (!state.enabled && stop) {
          stop(); stop = undefined;
        }
      } catch { /* Local playback does not depend on the optional LAN service. */ }
      finally { busy = false; }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5_000);
    return () => {
      controller.abort(); window.clearInterval(timer); stop?.();
    };
  }, []);
}
