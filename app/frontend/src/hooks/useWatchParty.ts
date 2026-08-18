"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyPlayback, PartyState } from "../lib/types";
import { emitAppEvent } from "../lib/events";
import {
  assertCompatibleWatchPartyProtocol,
  describeWatchPartyError,
  fetchWatchPartyState,
  postWatchParty,
  readWatchPartySession,
  saveWatchPartySession,
} from "../features/watch-party/api";
import type { WatchPartySession } from "../features/watch-party/types";
import {
  playbackChangedByUser,
  playbackReachedTarget,
  roomPlaybackRevision,
} from "../lib/watchPartyLogic";

export type { WatchPartySession } from "../features/watch-party/types";
export { WATCH_PARTY_SESSION_KEY } from "../features/watch-party/api";
export function useWatchParty({ enabled, server, name, mode, roomMode, playback, onHostState, onSessionChange }: {
  enabled: boolean;
  server: string;
  name: string;
  mode: "follow" | "free";
  roomMode: "host" | "shared";
  playback: PartyPlayback;
  onHostState: (playback: PartyPlayback, force?: boolean) => void;
  /** Lets the player switch away from local files before room polling begins. */
  onSessionChange?: (active: boolean) => void;
}) {
  const [session, setSession] = useState<WatchPartySession | null>(readWatchPartySession);
  const [party, setParty] = useState<PartyState | null>(null);
  const [error, setError] = useState("");
  const playbackRef = useRef(playback);
  const hostHandlerRef = useRef(onHostState);
  const lastLocalPlayback = useRef<PartyPlayback | null>(null);
  const lastRoomRevision = useRef("");
  const suppressControlUntil = useRef(0);
  playbackRef.current = playback;
  hostHandlerRef.current = onHostState;

  const remember = useCallback((next: WatchPartySession | null) => {
    onSessionChange?.(Boolean(next?.roomId));
    setSession(next);
    saveWatchPartySession(next);
  }, [onSessionChange]);
  const createRoom = useCallback(async () => {
    setError("");
    try {
      const result = await postWatchParty<WatchPartySession & { protocol?: number }>(
        server,
        "/watch-party/create",
        { name, roomMode },
      );
      assertCompatibleWatchPartyProtocol(result);
      remember(result);
    } catch (reason) {
      setError(describeWatchPartyError(reason, "Не удалось создать комнату"));
    }
  }, [server, name, roomMode, remember]);
  const joinRoom = useCallback(async (code: string) => {
    setError("");
    try {
      const result = await postWatchParty<WatchPartySession & { protocol?: number }>(server, "/watch-party/join", {
        roomId: code.trim().toUpperCase(),
        name,
        mode,
      });
      assertCompatibleWatchPartyProtocol(result);
      remember(result);
    } catch (reason) {
      setError(describeWatchPartyError(reason, "Не удалось подключиться"));
    }
  }, [server, name, mode, remember]);
  const leaveRoom = useCallback(async () => {
    const current = session;
    remember(null);
    setParty(null);
    if (current) void postWatchParty(server, "/watch-party/leave", current).catch(() => {});
  }, [server, session, remember]);
  const transferHost = useCallback(async (participantId: string) => {
    if (!session || session.role !== "host") return;
    setError("");
    try {
      await postWatchParty(server, "/watch-party/transfer-host", { ...session, participantId });
      remember({ ...session, role: "guest" });
    } catch (reason) {
      setError(describeWatchPartyError(reason, "Не удалось передать роль хоста"));
    }
  }, [server, session, remember]);

  useEffect(() => {
    if (!enabled || !session) {
      emitAppEvent("party-ping", { state: "idle" });
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
        const wasSettlingRemotePlayback = suppressControlUntil.current > 0;
        let suppressingRemotePlayback = Date.now() < suppressControlUntil.current;
        if (suppressingRemotePlayback && playbackReachedTarget(lastLocalPlayback.current, currentPlayback)) {
          suppressControlUntil.current = 0;
          suppressingRemotePlayback = false;
        } else if (wasSettlingRemotePlayback && !suppressingRemotePlayback) {
          // If an embedded player never reports the exact remote target, adopt
          // its final local state once. Never publish the stale pre-command
          // position back to the room when the settling timeout expires.
          suppressControlUntil.current = 0;
          lastLocalPlayback.current = { ...currentPlayback };
        }
        const control = mode === "follow"
          && !suppressingRemotePlayback
          && (
            (lastLocalPlayback.current === null && session.role === "host")
            || playbackChangedByUser(lastLocalPlayback.current, currentPlayback)
          );
        // Keep the remote target while its command is settling.
        if (!suppressingRemotePlayback) lastLocalPlayback.current = { ...currentPlayback };
        await postWatchParty(server, "/watch-party/update", {
          ...session,
          name,
          mode,
          roomMode,
          playback: currentPlayback,
          control,
        });
        const payload = await fetchWatchPartyState(server, session.roomId);
        if (!cancelled) {
          const next = payload;
          setParty(next);
          setError("");
          emitAppEvent("party-ping", {
            state: "connected",
            ms: Math.round(performance.now() - startedAt),
            roomId: session.roomId,
          });
          const self = next.participants.find(participant => participant.id === session.token);
          if (self?.role && self.role !== session.role) remember({ ...session, role: self.role });
          const revision = roomPlaybackRevision(next);
          const hasNewRoomCommand = revision !== lastRoomRevision.current;
          lastRoomRevision.current = revision;
          const mustFollow = mode === "follow"
            && next.playback
            && next.lastControllerId !== session.token
            && hasNewRoomCommand
            && (next.roomMode === "shared" || session.role === "guest");
          if (mustFollow && next.playback) {
            suppressControlUntil.current = Date.now() + 12_000;
            // Remote device clocks can differ by minutes. Keep the remote
            // position but anchor the comparison to this client's clock,
            // otherwise the received command can bounce back as a fake seek.
            lastLocalPlayback.current = {
              ...next.playback,
              updatedAt: currentPlayback.updatedAt,
            };
            hostHandlerRef.current(next.playback);
          }
        }
      } catch (reason) {
        if (!cancelled && (reason as { status?: number })?.status === 404) {
          remember(null);
          setParty(null);
          setError("");
          emitAppEvent("party-ping", { state: "idle" });
          return;
        }
        if (!cancelled) {
          setError(reason instanceof Error && reason.message !== "Not found"
            ? reason.message
            : "Сервер комнаты недоступен — перезапусти AnimeSoul");
          emitAppEvent("party-ping", { state: "error" });
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
      emitAppEvent("party-ping", { state: "idle" });
    };
  }, [enabled, server, session?.roomId, session?.token, session?.role, name, mode, roomMode, remember]);

  const catchUp = () => {
    if (!party?.playback) return;
    suppressControlUntil.current = Date.now() + 12_000;
    lastLocalPlayback.current = {
      ...party.playback,
      updatedAt: playbackRef.current.updatedAt,
    };
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

/** Public controller consumed by Watch Party UI components. */
export type WatchPartyController = ReturnType<typeof useWatchParty>;

export function useWatchPartyPresence({ enabled, server }: { enabled: boolean; server: string }) {
  const [session, setSession] = useState<WatchPartySession | null>(readWatchPartySession);
  const [party, setParty] = useState<PartyState | null>(null);

  useEffect(() => {
    if (!enabled || !session) {
      setParty(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await fetchWatchPartyState(server, session.roomId);
        if (cancelled) return;
        const next = payload;
        setParty(next);
        const self = next.participants.find(participant => participant.id === session.token);
        if (self?.role && self.role !== session.role) {
          const updated = { ...session, role: self.role };
          setSession(updated);
          saveWatchPartySession(updated);
        }
      } catch (reason) {
        if (!cancelled && (reason as { status?: number })?.status === 404) {
          setSession(null);
          setParty(null);
          saveWatchPartySession(null);
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
