import { useEffect, useState } from "react";
import type { Anime, HeroTrailer, SeasonGroup } from "../../lib/types";
import type { AnimeMetadata } from "./useAnimeMetadata";
import { fetchTitleTrailers, metadataTrailers, preferredTrailerGroup, youtubeTrailers } from "./franchiseTrailers";

export function AnimeTrailer({ animeId, videos, seasons = [], details = {} }: {
  animeId: number;
  videos?: AnimeMetadata["videos"];
  seasons?: SeasonGroup[];
  details?: Record<number, Anime>;
}) {
  const groups = seasons.length ? seasons : [{ number: 1, label: "Этот сезон", entries: [{ anime_id: animeId, title: "" }] }];
  const descriptor = JSON.stringify(groups.map(group => ({
    key: group.entries.map(entry => entry.anime_id).join(":"),
    entries: group.entries.map(entry => ({ ...entry, ...details[entry.anime_id] })),
  })));
  const [loaded, setLoaded] = useState<{ descriptor: string; titles: Record<number, HeroTrailer[]> }>();
  const [selection, setSelection] = useState<{ group: string; url?: string }>();
  useEffect(() => {
    let cancelled = false;
    const requested = JSON.parse(descriptor) as { entries: Anime[] }[];
    const entries = [...new Map(requested.flatMap(group => group.entries).map(entry => [entry.anime_id, entry])).values()];
    const titles: Record<number, HeroTrailer[]> = {};
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < entries.length) {
        const entry = entries[cursor++];
        titles[entry.anime_id] = await fetchTitleTrailers(entry).catch(() => []);
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker)).then(() => {
      if (!cancelled) setLoaded({ descriptor, titles });
    });
    return () => { cancelled = true; };
  }, [descriptor]);
  const titles = loaded?.descriptor === descriptor ? loaded.titles : {};
  const currentIndex = Math.max(0, groups.findIndex(group => group.entries.some(entry => entry.anime_id === animeId)));
  const options = groups.map((group, index) => ({
    index,
    key: group.entries.map(entry => entry.anime_id).join(":"),
    label: group.label ?? `Сезон ${group.number}`,
    trailers: youtubeTrailers(group.entries.flatMap(entry => [
      ...(entry.anime_id === animeId ? metadataTrailers(videos) : []),
      ...(titles[entry.anime_id] ?? []),
    ])),
  })).filter(group => group.trailers.length);
  const automatic = preferredTrailerGroup(options.map(group => group.index), currentIndex);
  const selected = options.find(group => group.key === selection?.group) ?? options.find(group => group.index === automatic);
  if (!selected) return null;
  const trailer = selected.trailers.find(item => item.url === selection?.url) ?? selected.trailers[0];
  const currentHasTrailer = options.some(group => group.index === currentIndex);
  return <section className="watch-trailer" aria-label="Трейлеры франшизы">
    <div className="watch-trailer-content">
      <iframe key={trailer.url} src={trailer.url} title={`${selected.label} · ${trailer.title || "Трейлер"}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
    </div>
    <div className="trailer-selectors">
      <h2>Трейлер · {selected.label}</h2>
      {options.length > 1 && <label>Сезон<select aria-label="Сезон трейлера" value={selected.key} onChange={event => setSelection({ group: event.target.value })}>
        {options.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
      </select></label>}
      {selected.trailers.length > 1 && <label>Ролик<select aria-label="Ролик сезона" value={trailer.url} onChange={event => setSelection({ group: selected.key, url: event.target.value })}>
        {selected.trailers.map((item, index) => <option key={item.url} value={item.url}>{item.title || `Трейлер ${index + 1}`}</option>)}
      </select></label>}
    </div>
    {!currentHasTrailer && selected.index !== currentIndex && <p className="trailer-season-notice">Для этого сезона трейлер не найден — показан «{selected.label}».</p>}
    {selected.index > currentIndex && <p className="trailer-season-notice">Трейлер следующего сезона может содержать спойлеры.</p>}
  </section>;
}
