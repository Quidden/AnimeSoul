import type { Anime, SeasonGroup } from "../../lib/types";
import { animeRoute, navigateTo } from "../navigation/routes";

type GraphEntry = { anime: Anime; group: SeasonGroup };

export function AnimeMapPage({ anime, seasons }: { anime: Anime; seasons: SeasonGroup[] }) {
  const seen = new Set<number>();
  const entries: GraphEntry[] = seasons.flatMap(group => group.entries.map(entry => ({ anime: entry, group })))
    .filter(item => {
      if (seen.has(item.anime.anime_id)) return false;
      seen.add(item.anime.anime_id);
      return true;
    });

  return <section className="anime-map-page">
    <button type="button" className="anime-map-back" onClick={() => navigateTo(animeRoute(anime.anime_id))}>← К странице аниме</button>
    <div className="anime-map-heading">
      <span className="eyebrow">КАРТА ФРАНШИЗЫ</span>
      <h1>{anime.title}</h1>
      <p>Порядок просмотра и связанные произведения по данным каталога. Нажмите на узел, чтобы открыть его страницу.</p>
    </div>
    <div className="anime-map-legend"><span><i /> Основная линия</span><span><i /> Фильм или спецвыпуск</span><span><i /> Текущий тайтл</span></div>
    <ol className="anime-map-graph" aria-label="Граф порядка просмотра">
      {entries.map(({anime: entry, group}, index) => {
        const branch = group.kind === "movie" || group.kind === "special";
        const current = entry.anime_id === anime.anime_id;
        return <li className={`anime-map-node${branch ? " is-branch" : ""}${current ? " is-current" : ""}`} key={entry.anime_id}>
          <span className="anime-map-junction" aria-hidden="true" />
          <button type="button" aria-current={current ? "page" : undefined} onClick={() => navigateTo(animeRoute(entry.anime_id))}>
            <span className="anime-map-order">{String(index + 1).padStart(2, "0")}</span>
            {entry.poster?.big ? <img src={entry.poster.big} alt="" loading="lazy" /> : <span className="anime-map-poster-empty" aria-hidden="true">◆</span>}
            <span className="anime-map-node-copy"><small>{branch ? group.kind === "movie" ? "Фильм" : "Спецвыпуск" : "Основная линия"}{current ? " · Текущий тайтл" : ""}</small><strong>{entry.title}</strong><span>{entry.year ?? "Год не указан"} · {entry.type?.name ?? "Аниме"}</span></span>
            <span className="anime-map-node-arrow" aria-hidden="true">↗</span>
          </button>
        </li>;
      })}
    </ol>
    {entries.length === 1 && <p className="anime-map-empty">Других связанных произведений в каталоге пока нет.</p>}
  </section>;
}
