import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { castBridge, castMediaSource, castOwnsPlayback, EMPTY_CAST_STATE, registerCastControl, sendCastCommand, type CastState } from "../../lib/cast";
import { listenAppEvent } from "../../lib/events";
import type { KodikDirectSource } from "../../lib/kodikStream";

export type CastProgress = { active: boolean; requestKey: string; position: number; duration: number; playing: boolean };
type Options = {
  enabled: boolean;
  source?: KodikDirectSource;
  localPlayback: boolean;
  requestKey: string;
  episodeKey: string;
  title: string;
  subtitle: string;
  video: RefObject<HTMLVideoElement | null>;
  progress: RefObject<CastProgress>;
  onReturn: (position: number) => void;
  onTimeUpdate?: (position: number, duration: number) => void;
  onEnded?: (duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
};

export function useAndroidCast(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<CastState>(EMPTY_CAST_STATE);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const requested = useRef(false);
  const load = useRef({ id: "", requestKey: "", episodeKey: "", url: "", ended: false });
  const startPosition = useRef(0);
  const stateRef = useRef(state);
  const source = useMemo(() => castMediaSource(options.source, options.localPlayback), [options.source, options.localPlayback]);

  useEffect(() => {
    if (!options.enabled || !castBridge()) return;
    const unsubscribe = listenAppEvent("cast-state", next => {
      const current = latest.current;
      stateRef.current = next;
      setState(next);
      if (requested.current && next.connected) {
        requested.current = false;
        if (!castMediaSource(current.source, current.localPlayback)) return;
        startPosition.current = current.video.current?.currentTime ?? 0;
        activeRef.current = true;
        current.progress.current = {
          active: true, requestKey: current.requestKey, position: startPosition.current,
          duration: current.video.current?.duration || 0, playing: true,
        };
        current.video.current?.pause();
        setActive(true);
      }
      if (activeRef.current && !next.connected && !next.suspended) {
        const progress = current.progress.current;
        current.onReturn(progress.requestKey === current.requestKey ? progress.position : 0);
        current.progress.current = { ...progress, active: false };
        activeRef.current = false;
        load.current = { id: "", requestKey: "", episodeKey: "", url: "", ended: false };
        setActive(false);
      }
      const item = load.current;
      if (!activeRef.current || item.requestKey !== current.requestKey || !castOwnsPlayback(next, item.id)) return;
      const previousPlaying = current.progress.current.playing;
      current.progress.current = {
        active: true, requestKey: item.requestKey,
        position: Number.isFinite(next.position) ? next.position : 0,
        duration: Number.isFinite(next.duration) ? next.duration : 0,
        playing: next.playing,
      };
      if (next.finished) {
        if (!item.ended) { item.ended = true; current.onEnded?.(next.duration); }
      } else if (!item.ended && !next.pendingId && next.duration > 0 && !next.error) {
        current.onTimeUpdate?.(next.position, next.duration);
      }
      if (previousPlaying !== next.playing) {
        if (next.playing) current.onPlay?.();
        else current.onPause?.();
      }
    });
    sendCastCommand("state");
    const refresh = () => { if (document.visibilityState === "visible") sendCastCommand("state"); };
    document.addEventListener("visibilitychange", refresh);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", refresh); };
  }, [options.enabled]);

  useEffect(() => {
    const video = options.video.current;
    if (!options.enabled || !video) return;
    return registerCastControl(video, (method, seconds) => {
      if (!activeRef.current) return false;
      const item = load.current;
      if (item.requestKey === latest.current.requestKey && castOwnsPlayback(stateRef.current, item.id)) {
        sendCastCommand(method, { id: item.id, position: seconds });
      }
      return true;
    });
  }, [options.enabled, options.video]);

  useEffect(() => {
    if (active && options.localPlayback) sendCastCommand("stop");
  }, [active, options.localPlayback]);

  useEffect(() => {
    if (!active || !state.connected || !source) return;
    const current = latest.current;
    const previous = load.current;
    if (previous.url === source.url && previous.requestKey === current.requestKey) return;
    const sameEpisode = previous.episodeKey === current.episodeKey;
    const position = !previous.id ? startPosition.current : sameEpisode ? current.progress.current.position : 0;
    const autoplay = !previous.id || !sameEpisode || current.progress.current.playing;
    const id = `animesoul:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    load.current = { id, requestKey: current.requestKey, episodeKey: current.episodeKey, url: source.url, ended: false };
    current.progress.current = { active: true, requestKey: current.requestKey, position, duration: 0, playing: autoplay };
    sendCastCommand("load", { id, ...source, position, autoplay, title: current.title, subtitle: current.subtitle });
  }, [active, state.connected, source, options.requestKey]);

  const command = (action: string, data: Record<string, unknown> = {}) => sendCastCommand(action, { ...data, id: load.current.id });
  const choose = () => {
    if (!activeRef.current && source) requested.current = true;
    if (stateRef.current.connected && requested.current) {
      // Ask for a fresh snapshot, then the same connection path loads this episode.
      sendCastCommand("state");
    } else sendCastCommand("choose");
  };
  const matchingMedia = castOwnsPlayback(state, load.current.id);
  const progress = options.progress.current;
  const visibleState = active && !matchingMedia ? {
    ...state, pendingId: load.current.id || "loading", playing: false, finished: false,
    position: progress.requestKey === options.requestKey ? progress.position : 0,
    duration: progress.requestKey === options.requestKey ? progress.duration : 0,
  } : state;
  return { state: visibleState, active, supported: options.enabled && Boolean(castBridge()), canCast: Boolean(source), choose, command };
}
