"use client";
import {
  frameSearchLimits,
  frameSearchTypes,
  frameSearchResultSchema,
  episodeHref,
  type FrameSearchMatch,
} from "@animesoul/contracts";

export function frameWatchHref(match: FrameSearchMatch) {
  if (!match.anime) return null;
  return match.watch
    ? episodeHref(match.anime.slug, match.watch.episodeId, match.timestamp) + "#anime-watch"
    : `/anime/${match.anime.slug}#anime-watch`;
}

export function frameFileError(file: File) {
  if (!file.size) return "Выберите непустое изображение.";
  if (file.size > frameSearchLimits.bytes) return "Размер кадра — не более 5 МБ.";
  if (
    !/\.(?:jpe?g|png|webp|gif)$/i.test(file.name) ||
    (file.type && !frameSearchTypes.some((type) => type === file.type))
  )
    return "Выберите JPEG, PNG, WebP или GIF.";
  return null;
}
export async function searchByFrame(file: File, signal: AbortSignal) {
  const invalid = frameFileError(file);
  if (invalid) throw new Error(invalid);
  const response = await fetch("/api/search/frame", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
    headers: { "Content-Type": "application/octet-stream", "X-AnimeSoul-Request": "1" },
    body: file,
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result && typeof result === "object" && "message" in result ? result.message : null;
    throw new Error(
      typeof message === "string"
        ? message
        : response.status === 429
          ? "Слишком много запросов. Подождите и повторите поиск."
          : response.status === 413
            ? "Размер кадра — не более 5 МБ."
            : "Поиск по кадру временно недоступен.",
    );
  }
  const parsed = frameSearchResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("Поиск вернул некорректный ответ. Попробуйте позже.");
  return parsed.data;
}
export function frameTimestamp(seconds: number) {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor(whole / 60) % 60;
  const s = whole % 60;
  return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}
