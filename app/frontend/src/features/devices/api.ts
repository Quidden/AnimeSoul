import { requestJson } from "../../lib/http";

export type Device = {
  id: string; name: string; host: string; saves: boolean; media: boolean; control: boolean;
  priority: number; online?: boolean; error?: string;
};
export type Transfer = {
  id: string; peerId: string; title: string; status: string; total: number; completed: number;
  bytes: number; totalBytes: number; error: string;
};
export type DeviceStatus = {
  id: string; name: string; enabled: boolean; listening: boolean; addresses: string[]; port: number;
  localPriority: boolean; peers: Device[]; transfers: Transfer[];
};
export type LanCommand = {
  id: string; action: "play" | "pause" | "seek" | "open" | "episode" | "next" | "previous";
  animeId?: number; season?: number; episode?: string; dubbing?: string; seconds?: number;
};
export type LanPlayer = {
  animeId?: number; title?: string; season?: number; episode?: string; dubbing?: string;
  position?: number; duration?: number; playing?: boolean;
  episodes?: { season: number; episode: string; dubbing: string }[];
};
export type RemoteState = { id: string; name: string; saves: boolean; media: boolean; control: boolean; player: LanPlayer; results: Record<string, string> };

export function lanRequest<T>(path: string, method = "GET", value?: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(`/api/lan${path}`, {
    method, signal, cache: "no-store",
    ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  });
}
