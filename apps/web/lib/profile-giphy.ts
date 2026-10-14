"use client";
import { giphyIdSchema } from "@animesoul/contracts";

type Rendition = { url: string; width?: string; height?: string };
export type GiphyGif = {
  id: string;
  title: string;
  images: Record<string, Rendition>;
};
let keyRequest: Promise<string> | undefined;
export async function giphyKey() {
  keyRequest ??= fetch("/api/profile-giphy/config", {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(10000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось подключить GIPHY. Повторите позже.");
      const config = (await response.json()) as { apiKey?: unknown };
      if (typeof config.apiKey !== "string" || !config.apiKey)
        throw new Error("Выбор GIF временно недоступен: GIPHY не настроен.");
      return config.apiKey;
    })
    .catch((error: unknown) => {
      keyRequest = undefined;
      throw error;
    });
  return keyRequest;
}
export function giphyMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^(?:media\d*|i)\.giphy\.com$/.test(url.hostname) &&
      url.pathname.endsWith(".gif")
      ? value
      : null;
  } catch {
    return null;
  }
}
export function giphyRendition(gif: GiphyGif, cover = false): string | null {
  const keys = cover
    ? ["downsized_medium", "downsized", "original"]
    : ["fixed_height", "downsized", "original"];
  for (const key of keys) {
    const url = giphyMediaUrl(gif.images[key]?.url);
    if (url) return url;
  }
  return null;
}
function parseGif(value: unknown): GiphyGif {
  if (!value || typeof value !== "object") throw new Error("GIPHY вернул некорректный ответ.");
  const item = value as GiphyGif;
  if (!giphyIdSchema.safeParse(item.id).success || !item.images || typeof item.images !== "object")
    throw new Error("GIPHY вернул некорректный ответ.");
  return {
    id: item.id,
    title: typeof item.title === "string" && item.title.trim() ? item.title : "Anime GIF",
    images: item.images,
  };
}
async function request(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const url = new URL("https://api.giphy.com/v1/gifs/" + path);
  url.search = new URLSearchParams({ api_key: await giphyKey(), ...params }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Лимит GIPHY исчерпан. Попробуйте позже или загрузите свой GIF."
        : "Не удалось загрузить GIF из GIPHY. Повторите позже.",
    );
  return (await response.json()) as {
    data: unknown;
    pagination?: { offset: number; count: number; total_count: number };
  };
}
export async function searchGiphy(query: string, offset = 0, signal?: AbortSignal) {
  const q = query.trim();
  if (!q || q.length > 50) throw new Error("Введите запрос для GIPHY длиной от 1 до 50 символов.");
  const response = await request(
    "search",
    { q, limit: "12", offset: String(offset), rating: "pg-13" },
    signal,
  );
  if (!Array.isArray(response.data)) throw new Error("GIPHY вернул некорректный ответ.");
  const items = response.data.map(parseGif);
  const next = offset + items.length;
  return {
    items,
    nextOffset:
      items.length && next < (response.pagination?.total_count ?? next) && next <= 4999
        ? next
        : null,
  };
}
export function searchAnimeGiphy(offset = 0, signal?: AbortSignal) {
  return searchGiphy("anime", offset, signal);
}
const resolving = new Map<string, Promise<GiphyGif>>();
export function getProfileGiphy(id: string) {
  const valid = giphyIdSchema.parse(id);
  let pending = resolving.get(valid);
  if (!pending) {
    pending = request(valid, {})
      .then((result) => parseGif(result.data))
      .finally(() => resolving.delete(valid));
    resolving.set(valid, pending);
  }
  return pending;
}
