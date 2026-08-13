import type { PartyState } from "../../lib/types";
import type { WatchPartySession } from "./types";

export const WATCH_PARTY_PROTOCOL = 2;
export const WATCH_PARTY_SESSION_KEY = "animesoul:watch-party-session";

type WatchPartyRequestError = Error & {
  status?: number;
  code?: string;
};

const endpoint = (server: string, path: string) =>
  `${server.replace(/\/+$/, "")}${path}`;

export function readWatchPartySession(): WatchPartySession | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(
      sessionStorage.getItem(WATCH_PARTY_SESSION_KEY) || "null",
    ) as WatchPartySession | null;
  } catch {
    return null;
  }
}

export function saveWatchPartySession(session: WatchPartySession | null): void {
  if (typeof window === "undefined") return;
  if (session) {
    sessionStorage.setItem(WATCH_PARTY_SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(WATCH_PARTY_SESSION_KEY);
  }
}

export function describeWatchPartyError(reason: unknown, fallback: string): string {
  const error = reason as WatchPartyRequestError;
  if (error.code === "PARTICIPANT_NOT_FOUND") {
    return "Участник отключился от комнаты. Подождите его переподключения и попробуйте снова.";
  }
  if (error.code === "ROOM_NOT_FOUND") {
    return "Комната больше не существует. Создайте новую комнату.";
  }
  if (error.code === "NOT_HOST") {
    return "Передать роль может только текущий хост.";
  }
  if (error.status === 404) {
    return error.message || "Команда не поддерживается сервером совместного просмотра. Перезапустите AnimeSoul у хоста.";
  }
  return reason instanceof Error ? reason.message : fallback;
}

export function normalizeParty(value: PartyState): PartyState {
  return {
    ...value,
    roomMode: value.roomMode === "shared" ? "shared" : "host",
  };
}

export function assertCompatibleWatchPartyProtocol(value: { protocol?: number }): void {
  if (value.protocol === WATCH_PARTY_PROTOCOL) return;
  const error = new Error(
    "Сервер совместного просмотра запущен из старой версии AnimeSoul. Полностью закройте старый сервер и запустите приложение заново.",
  ) as WatchPartyRequestError;
  error.code = "UNSUPPORTED_PROTOCOL";
  throw error;
}

export async function postWatchParty<T = unknown>(
  server: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(endpoint(server, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(String(payload.error || "Ошибка комнаты")) as WatchPartyRequestError;
    error.status = response.status;
    error.code = typeof payload.code === "string" ? payload.code : undefined;
    throw error;
  }
  return payload as T;
}

export async function fetchWatchPartyState(
  server: string,
  roomId: string,
): Promise<PartyState> {
  const response = await fetch(
    endpoint(server, `/watch-party/state?room=${encodeURIComponent(roomId)}`),
    { cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(String(payload.error || "Комната недоступна")) as WatchPartyRequestError;
    error.status = response.status;
    error.code = typeof payload.code === "string" ? payload.code : undefined;
    throw error;
  }
  assertCompatibleWatchPartyProtocol(payload);
  return normalizeParty(payload as unknown as PartyState);
}
