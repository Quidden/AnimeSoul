export type PlayerEvent =
  | { kind: "time"; position: number; duration?: number }
  | { kind: "seek"; position: number }
  | { kind: "play" | "pause" | "ended" | "ready" }
  | { kind: "episode"; number: string; season?: string; translation?: string }
  | { kind: "duration"; duration: number };
// The caller must also compare event.source with the current iframe window.
export function embeddedPlayerEvent(
  data: unknown,
  origin: string,
  embedUrl: string,
): PlayerEvent | null {
  if (origin !== new URL(embedUrl).origin) return null;
  if (typeof data === "string") {
    if (data.length > 16384) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  const events: Record<string, "play" | "pause" | "ended" | "ready"> = {
    kodik_player_play: "play",
    kodik_player_pause: "pause",
    kodik_player_video_ended: "ended",
    kodik_player_loaded: "ready",
    kodik_player_ready: "ready",
    kodik_player_video_play: "play",
    kodik_player_video_started: "play",
    kodik_player_video_pause: "pause",
  };
  if (typeof message.key !== "string") return null;
  const kind = events[message.key];
  if (kind) return { kind };
  if (
    message.key === "kodik_player_duration_update" &&
    typeof message.value === "number" &&
    Number.isFinite(message.value) &&
    message.value > 0 &&
    message.value <= 86400
  )
    return { kind: "duration", duration: message.value };
  if (message.key === "kodik_player_current_episode") {
    const value =
      typeof message.value === "object" && message.value !== null
        ? (message.value as Record<string, unknown>)
        : {};
    const number = value.episode ?? value.current_episode ?? message.value,
      season = value.season ?? value.current_season;
    const translation =
      typeof value.translation === "object" && value.translation !== null
        ? (value.translation as Record<string, unknown>).title
        : undefined;
    if (
      (typeof number !== "number" && typeof number !== "string") ||
      !/^[\p{L}\p{N} ._-]{1,30}$/u.test(String(number))
    )
      return null;
    return {
      kind: "episode",
      number: String(number),
      ...(season !== undefined && /^[\p{L}\p{N} ._-]{1,30}$/u.test(String(season))
        ? { season: String(season) }
        : {}),
      ...(typeof translation === "string" &&
      translation.trim().length > 0 &&
      translation.length <= 160
        ? { translation: translation.trim() }
        : {}),
    };
  }
  const snapshot = message.key === "kodik_player_seek" || message.key === "kodik_player_time";
  if (message.key !== "kodik_player_time_update" && !snapshot) return null;
  const value =
    typeof message.value === "object" && message.value !== null
      ? (message.value as Record<string, unknown>)
      : {};
  const position =
    typeof message.value === "number" ? message.value : (value.time ?? value.currentTime);
  const duration = value.duration;
  if (
    typeof position !== "number" ||
    !Number.isFinite(position) ||
    position < 0 ||
    position > 86400
  )
    return null;
  if (
    duration !== undefined &&
    (typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 86400 ||
      position > duration)
  )
    return null;
  return snapshot
    ? { kind: "seek", position }
    : { kind: "time", position, ...(typeof duration === "number" ? { duration } : {}) };
}
