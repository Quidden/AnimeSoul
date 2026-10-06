export type ProfilePreset = { id: string; kind: "avatar" | "banner"; name: string; animated: boolean; url: string };
export type ProfileMediaOptions = { presets: ProfilePreset[]; canCustomize: boolean; giphyEnabled: boolean };
export type GiphyItem = { id: string; title: string; preview: string; url: string };
type GiphyImage = { url?: string };
type GiphyResult = { id: string; title?: string; images?: { original?: GiphyImage; fixed_width?: GiphyImage } };

export function giphyReference(id: string): string {
  if (!/^[a-zA-Z0-9]{1,100}$/.test(id)) throw new Error("Некорректный GIF");
  return `giphy:${id}`;
}
export function giphyUrl(value?: string): string {
  if (!value) throw new Error("GIF недоступен");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.endsWith(".giphy.com")) throw new Error("Некорректный адрес GIF");
  return value;
}
export function giphySearchUrl(key: string, query: string, offset = 0): string {
  const url = new URL(`https://api.giphy.com/v1/gifs/${query ? "search" : "trending"}`);
  url.search = new URLSearchParams({ api_key: key, limit: "12", offset: String(offset), rating: "pg", lang: "ru", ...(query ? { q: query } : {}) }).toString();
  return url.toString();
}
export async function searchGiphy(key: string, query: string, offset: number, signal: AbortSignal) {
  const response = await fetch(giphySearchUrl(key, query, offset), { signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 429 ? "Лимит поиска временно исчерпан. Попробуйте позже." : "Поиск GIF временно недоступен. Попробуйте ещё раз.");
  const result = await response.json() as { data: GiphyResult[]; pagination: { total_count: number; offset: number; count: number } };
  return { items: result.data.map(item => ({ id: item.id, title: item.title || "Аниме GIF", preview: giphyUrl(item.images?.fixed_width?.url || item.images?.original?.url), url: giphyUrl(item.images?.original?.url) })),
    nextOffset: result.pagination.offset + result.pagination.count, total: result.pagination.total_count };
}
