import { useEffect, useState } from "react";
import { useAccount } from "./context";
import { giphyReference, giphyUrl } from "./profileMedia";

export function useProfileMedia(source: string) {
  const { config } = useAccount();
  const [resolved, setResolved] = useState({ source: "", url: "", error: "" });
  const key = config.giphyKey;
  useEffect(() => {
    if (!source.startsWith("giphy:") || !key) return;
    const controller = new AbortController();
    const id = source.slice(6);
    void (async () => {
      giphyReference(id);
      const url = new URL(`https://api.giphy.com/v1/gifs/${id}`);
      url.searchParams.set("api_key", key);
      const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
      if (!response.ok) throw new Error("GIF временно недоступен");
      const result = await response.json() as { data: { images: { original: { url: string } } } };
      if (!controller.signal.aborted) setResolved({ source, url: giphyUrl(result.data.images.original.url), error: "" });
    })().catch(() => { if (!controller.signal.aborted) setResolved({ source, url: "", error: "GIF временно недоступен" }); });
    return () => controller.abort();
  }, [source, key]);
  if (!source.startsWith("giphy:")) return { url: source, error: "" };
  return resolved.source === source ? resolved : { url: "", error: key ? "" : "Поиск GIF ещё не подключён" };
}
