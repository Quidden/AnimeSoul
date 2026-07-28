"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyPlayback, PartyState } from "../lib/types";

export type WatchPartySession = { roomId: string; token: string; role: "host" | "guest" };
export const WATCH_PARTY_SESSION_KEY = "animesoul:watch-party-session";

const endpoint = (server: string, path: string) => `${server.replace(/\/+$/, "")}${path}`;
const readSession = () => {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(WATCH_PARTY_SESSION_KEY) || "null") as WatchPartySession | null;
  } catch {
    return null;
  }
};
const saveSession = (session: WatchPartySession | null) => {
  if (session) sessionStorage.setItem(WATCH_PARTY_SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(WATCH_PARTY_SESSION_KEY);
};
type PartyRequestError = Error & { status?: number; code?: string };
const roomError = (reason: unknown, fallback: string) => {
  const error = reason as PartyRequestError;
  if (error.code === "PARTICIPANT_NOT_FOUND") return "Участник отключился от комнаты. Подождите его переподключения и попробуйте снова.";
  if (error.code === "ROOM_NOT_FOUND") return "Комната больше не существует. Создайте новую комнату.";
  if (error.code === "NOT_HOST") return "Передать роль может только текущий хост.";
  if (error.status === 404) return error.message || "Команда не поддерживается сервером совместного просмотра. Перезапустите AnimeSoul у хоста.";
  return reason instanceof Error ? reason.message : fallback;
};
const post = async (server: string, path: string, body: unknown) => {
  const response = await fetch(endpoint(server, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Ошибка комнаты") as PartyRequestError;
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
};
const normalizeParty = (value: PartyState) => ({
  ...value,
  roomMode: value.roomMode === "shared" ? "shared" as const : "host" as const,
});
const playbackChangedByUser = (previous: PartyPlayback | null, current: PartyPlayback) => {
  if (!previous) return false;
  if (
    previous.animeId !== current.animeId
    || previous.season !== current.season
    || previous.episode !== current.episode
    || previous.dub !== current.dub
    || previous.player !== current.player
    || previous.playing !== current.playing
  ) return true;
  const expectedPosition = previous.playing
    ? previous.position + Math.max(0, (current.updatedAt - previous.updatedAt) / 1000)
    : previous.position;
  return Math.abs(current.position - expectedPosition) > 3;
};

export function useWatchParty({ enabled, server, name, mode, roomMode, playback, onHostState }: {
  enabled: boolean;
  server: string;
  name: string;
  mode: "follow" | "free";
  roomMode: "host" | "shared";
  playback: PartyPlayback;
  onHostState: (playback: PartyPlayback, force?: boolean) => void;
}) {
  const [session, setSession] = useState<WatchPartySession | null>(readSession);
  const [party, setParty] = useState<PartyState | null>(null);
  const [error, setError] = useState("");
  const playbackRef = useRef(playback);
  const hostHandlerRef = useRef(onHostState);
  const lastLocalPlayback = useRef<PartyPlayback | null>(null);
  const suppressControlUntil = useRef(0);
  playbackRef.current = playback;
  hostHandlerRef.current = onHostState;

  const remember = useCallback((next: WatchPartySession | null) => {
    setSession(next);
    saveSession(next);
  }, []);
  const createRoom = useCallback(async () => {
    setError("");
    try {
      const result = await post(server, "/watch-party/create", { name, roomMode });
      remember(result as WatchPartySession);
    } catch (reason) {
      setError(roomError(reason, "Не удалось создать комнату"));
    }
  }, [server, name, roomMode, remember]);
  const joinRoom = useCallback(async (code: string) => {
    setError("");
    try {
      const result = await post(server, "/watch-party/join", {
        roomId: code.trim().toUpperCase(),
        name,
        mode,
      });
      remember(result as WatchPartySession);
    } catch (reason) {
      setError(roomError(reason, "Не удалось подключиться"));
    }
  }, [server, name, mode, remember]);
  const leaveRoom = useCallback(async () => {
    const current = session;
    remember(null);
    setParty(null);
    if (current) void post(server, "/watch-party/leave", current).catch(() => {});
  }, [server, session, remember]);
  const transferHost = useCallback(async (participantId: string) => {
    if (!session || session.role !== "host") return;
    setError("");
    try {
      await post(server, "/watch-party/transfer-host", { ...session, participantId });
      remember({ ...session, role: "guest" });
    } catch (reason) {
      setError(roomError(reason, "Не удалось передать роль хоста"));
    }
  }, [server, session, remember]);

  useEffect(() => {
    if (!enabled || !session) {
      window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "idle" } }));
      return;
    }
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const startedAt = performance.now();
      try {
        const currentPlayback = playbackRef.current;
        const control = mode === "follow"
          && Date.now() >= suppressControlUntil.current
          && (
            (lastLocalPlayback.current === null && session.role === "host")
            || playbackChangedByUser(lastLocalPlayback.current, currentPlayback)
          );
        lastLocalPlayback.current = { ...currentPlayback };
        await post(server, "/watch-party/update", {
          ...session,
          name,
          mode,
          roomMode,
          playback: currentPlayback,
          control,
        });
        const response = await fetch(
          endpoint(server, `/watch-party/state?room=${encodeURIComponent(session.roomId)}`),
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) {
          const stateError = new Error(payload.error || "Комната недоступна") as Error & { status?: number };
          stateError.status = response.status;
          throw stateError;
        }
        if (!cancelled) {
          const next = normalizeParty(payload as PartyState);
          setParty(next);
          setError("");
          window.dispatchEvent(new CustomEvent("animesoul:party-ping", {
            detail: {
              state: "connected",
              ms: Math.round(performance.now() - startedAt),
              roomId: session.roomId,
            },
          }));
          const self = next.participants.find(participant => participant.id === session.token);
          if (self?.role && self.role !== session.role) remember({ ...session, role: self.role });
          const mustFollow = mode === "follow"
            && next.playback
            && next.lastControllerId !== session.token
            && (next.roomMode === "shared" || session.role === "guest");
          if (mustFollow && next.playback) {
            suppressControlUntil.current = Date.now() + 2500;
            lastLocalPlayback.current = { ...next.playback };
            hostHandlerRef.current(next.playback);
          }
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
          setError(reason instanceof Error && reason.message !== "Not found"
            ? reason.message
            : "Сервер комнаты недоступен — перезапусти AnimeSoul");
          window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "error" } }));
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.dispatchEvent(new CustomEvent("animesoul:party-ping", { detail: { state: "idle" } }));
    };
  }, [enabled, server, session?.roomId, session?.token, session?.role, name, mode, roomMode, remember]);

  const catchUp = () => {
    if (!party?.playback) return;
    suppressControlUntil.current = Date.now() + 2500;
    lastLocalPlayback.current = { ...party.playback };
    hostHandlerRef.current(party.playback, true);
  };
  return {
    session,
    party,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    transferHost,
    catchUp,
  };
}

export function useWatchPartyPresence({ enabled, server }: { enabled: boolean; server: string }) {
  const [session, setSession] = useState<WatchPartySession | null>(readSession);
  const [party, setParty] = useState<PartyState | null>(null);

  useEffect(() => {
    if (!enabled || !session) {
      setParty(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          endpoint(server, `/watch-party/state?room=${encodeURIComponent(session.roomId)}`),
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) throw Object.assign(new Error(payload.error || "Комната недоступна"), { status: response.status });
        if (cancelled) return;
        const next = normalizeParty(payload as PartyState);
        setParty(next);
        const self = next.participants.find(participant => participant.id === session.token);
        if (self?.role && self.role !== session.role) {
          const updated = { ...session, role: self.role };
          setSession(updated);
          saveSession(updated);
        }
      } catch (reason) {
        if (!cancelled && (reason as { status?: number })?.status === 404) {
          setSession(null);
          setParty(null);
          saveSession(null);
        }
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, server, session?.roomId, session?.token, session?.role]);

  return { session, party };
}
