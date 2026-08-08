/** Helpers for turning YummyAnime's single-episode Kodik embeds into one
 * stable serial player. Keeping the iframe URL stable is also what allows
 * Kodik to change an episode without dropping browser fullscreen mode. */

const SINGLE_EPISODE_PARAMS = ["only_episode", "only_season", "translations"] as const;

function parseEmbedUrl(source: string): URL | null {
  if (!source) return null;
  try {
    return new URL(source.startsWith("//") ? `https:${source}` : source, "http://localhost");
  } catch {
    return null;
  }
}

export function isKodikEmbed(source?: string, player?: string): boolean {
  return /kodik/i.test(`${source ?? ""} ${player ?? ""}`);
}

/** Returns the common season player URL while opening on the requested
 * episode. Kodik keeps its own episode/translation controls in this mode. */
export function kodikSerialSource(source: string, episode?: string, startAt = 0): string {
  const url = parseEmbedUrl(source);
  if (!url || !isKodikEmbed(source)) return source;
  SINGLE_EPISODE_PARAMS.forEach(parameter => url.searchParams.delete(parameter));
  if (episode) url.searchParams.set("episode", episode);
  else url.searchParams.delete("episode");
  if (startAt > 5) url.searchParams.set("start_from", String(Math.floor(startAt)));
  else url.searchParams.delete("start_from");
  return url.toString();
}

/** Episode and resume position do not belong to the iframe identity. A change
 * of this key means that the translation/source really changed and the iframe
 * must be reloaded. */
export function kodikSerialIdentity(source: string): string {
  const url = parseEmbedUrl(source);
  if (!url || !isKodikEmbed(source)) return source;
  [...SINGLE_EPISODE_PARAMS, "episode", "start_from"].forEach(parameter => url.searchParams.delete(parameter));
  url.hash = "";
  return url.toString();
}

export function playerEpisode(value: unknown): string {
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (!value || typeof value !== "object") return "";
  const payload = value as Record<string, unknown>;
  return String(payload.episode ?? payload.current_episode ?? payload.number ?? "");
}

export function playerDubbing(value: unknown): string {
  const visit = (candidate: unknown, depth = 0): string => {
    if (depth > 4 || candidate == null) return "";
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try { return visit(JSON.parse(trimmed), depth + 1); } catch { /* Use the original string below. */ }
      }
      return candidate;
    }
    if (typeof candidate !== "object") return "";
    const payload = candidate as Record<string, unknown>;
    const direct = payload.translation_title ?? payload.dubbing_title ?? payload.voice_title
      ?? payload.title ?? payload.name;
    if (typeof direct === "string" && direct.trim()) return direct;
    for (const key of ["dubbing", "translation", "voice", "data", "value"]) {
      const nested = visit(payload[key], depth + 1);
      if (nested) return nested;
    }
    return "";
  };
  return visit(value);
}

/** Kodik versions do not all use the same event shape. Some report the
 * localized translation title, while others only report its numeric id. */
export function playerTranslationId(value: unknown): string {
  const visit = (candidate: unknown, depth = 0): string => {
    if (depth > 4 || candidate == null) return "";
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try { return visit(JSON.parse(trimmed), depth + 1); } catch { /* Treat it as an id below. */ }
      }
    }
    // Some builds emit `translation_changed` with a nested primitive value.
    // A primitive at the root is intentionally ignored because episode events
    // also commonly use a bare number.
    if (depth > 0 && (typeof candidate === "string" || typeof candidate === "number")) return String(candidate);
    if (typeof candidate !== "object") return "";
    const payload = candidate as Record<string, unknown>;
    const direct = payload.translation_id ?? payload.translationId
      ?? payload.dubbing_id ?? payload.dubbingId ?? payload.voice_id ?? payload.voiceId
      ?? (depth > 0 ? payload.id : undefined);
    if (typeof direct === "string" || typeof direct === "number") return String(direct);
    for (const key of ["dubbing", "translation", "voice", "data", "value"]) {
      const nested = visit(payload[key], depth + 1);
      if (nested) return nested;
    }
    return "";
  };
  return visit(value);
}
