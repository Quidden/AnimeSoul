"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyPlayback, PartyState } from "../lib/types";

type Session = { roomId: string; token: string; role: "host" | "guest" };
const SESSION_KEY = "animesoul:watch-party-session";

const endpoint = (server: string, path: string) => `${server.replace(/\/+$/, "")}${path}`;
const roomError = (reason: unknown, fallback: string) =>
  (reason as { status?: number })?.status === 404
    ? "Сервер совместного просмотра не запущен или устарел — перезапусти AnimeSoul"
    : reason instanceof Error ? reason.message : fallback;
const post = async (server: string, path: string, body: unknown) => {
  const response = await fetch(endpoint(server, path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || payload.detail || "Ошибка комнаты") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
};

export function useWatchParty({ enabled, server, name, mode, playback, onHostState }: {
  enabled: boolean;
  server: string;
  name: string;
  mode: "follow" | "free";
  playback: PartyPlayback;
  onHostState: (playback: PartyPlayback, force?: boolean) => void;
}) {
  const [session, setSession] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as Session | null; } catch { return null; }
  });
  const [party, setParty] = useState<PartyState | null>(null);
  const [error, setError] = useState("");
  const playbackRef = useRef(playback), hostHandlerRef = useRef(onHostState);
  playbackRef.current = playback;
  hostHandlerRef.current = onHostState;

  const remember = (next: Session | null) => {
    setSession(next);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  };
  const createRoom = useCallback(async () => {
    setError("");
    try { const result = await post(server, "/watch-party/create", { name }); remember(result as Session); } catch (reason) { setError(roomError(reason, "Не удалось создать комнату")); }
  }, [server, name]);
  const joinRoom = useCallback(async (code: string) => {
    setError("");
    try { const result = await post(server, "/watch-party/join", { roomId: code.trim().toUpperCase(), name, mode }); remember(result as Session); } catch (reason) { setError(roomError(reason, "Не удалось подключиться")); }
  }, [server, name, mode]);
  const leaveRoom = useCallback(async () => {
    const current = session;
    remember(null);
    setParty(null);
    if (current) void post(server, "/watch-party/leave", current).catch(() => {});
  }, [server, session]);

  useEffect(() => {
    if (!enabled || !session) {
      window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "idle" } }));
      return;
    }
    let cancelled = false, busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const startedAt = performance.now();
      try {
        await post(server, "/watch-party/update", { ...session, name, mode, playback: playbackRef.current });
        const response = await fetch(endpoint(server, `/watch-party/state?room=${encodeURIComponent(session.roomId)}`), { cache: "no-store" });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || next.detail || "Комната недоступна");
        if (!cancelled) {
          setParty(next as PartyState);
          setError("");
          window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "connected", ms: Math.round(performance.now() - startedAt), roomId: session.roomId } }));
          if (session.role === "guest" && mode === "follow" && next.playback) hostHandlerRef.current(next.playback as PartyPlayback);
        }
      } catch (reason) {
        if (!cancelled && (reason as { status?: number })?.status === 404) {
          remember(null);
          setParty(null);
          setError("");
          window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "idle" } }));
          return;
        }
        if (!cancelled) {
          setError(reason instanceof Error && reason.message !== "Not found" ? reason.message : "Сервер комнаты недоступен — перезапусти AnimeSoul");
          window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "error" } }));
        }
      } finally { busy = false; }
    };
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "idle" } }));
    };
  }, [enabled, server, session?.roomId, session?.token, session?.role, name, mode]);

  const catchUp = () => { if (party?.playback) hostHandlerRef.current(party.playback, true); };
  return { session, party, error, createRoom, joinRoom, leaveRoom, catchUp };
}
