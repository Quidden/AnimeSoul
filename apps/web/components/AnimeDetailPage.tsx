import { AnimeAnnouncements } from "./SiteExperience";
import Link from "next/link";
import type { Anime, AnimeCharacter, AnimeFranchise, Episode } from "@animesoul/contracts";
import { AnimeCharacters } from "./AnimeCharacters";
import { AnimeLibraryActions } from "./AnimeLibraryActions";
import { AnimeRatings } from "./AnimeRatings";
import { AnimeTrailer } from "./AnimeTrailer";
import { AnimeWatch } from "./AnimeWatch";
import { CommentsPanel } from "./ContentPanels";
import { AnimeScreenshots } from "./AnimeScreenshots";
import { Icon } from "./Icon";
import { formatLabels } from "../lib/catalog-filters";

export function AnimeDetailPage({
  anime,
  franchise,
  characters = [],
  initialEpisode,
  initialTime,
  resumeRequested = false,
}: {
  anime: Anime;
  franchise: AnimeFranchise;
  characters?: AnimeCharacter[];
  initialEpisode?: Episode;
  initialTime?: number;
  resumeRequested?: boolean;
}) {
  const details = anime.details;
  const status =
    anime.status === "released" ? "Вышло" : anime.status === "ongoing" ? "Онгоинг" : "Анонс";
  const current = franchise.items.find((part) => part.anime.id === anime.id);
  const count = details?.episodesTotal ?? current?.episodes.length;
  return (
    <article className="watch-shell anime-detail-page">
      <nav className="anime-breadcrumb" aria-label="Навигационная цепочка">
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        {initialEpisode ? (
          <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
        ) : (
          <span>{anime.title}</span>
        )}
        {initialEpisode && (
          <>
            <span>/</span>
            <span>Серия {initialEpisode.number}</span>
          </>
        )}
      </nav>
      <AnimeAnnouncements animeId={anime.id} />
      <div className="watch-anime-hero">
        <aside className="watch-anime-rail">
          {anime.poster ? (
            <img src={anime.poster} alt={`Постер: ${anime.title}`} width="270" height="405" />
          ) : (
            <div className="watch-anime-poster-empty">
              <Icon name="image" />
            </div>
          )}
          <div className="watch-poster-actions">
            <a className="primary watch-start" href="#anime-watch">
              <span aria-hidden="true">▶</span> Смотреть
            </a>
            <AnimeLibraryActions key={anime.id} animeId={anime.id} />
            {franchise.items.length > 1 && (
              <Link className="outline" href={`/anime/${anime.slug}/franchise`}>
                Карта франшизы · {franchise.items.length} →
              </Link>
            )}
            <Link className="outline" href={`/anime/${anime.slug}/community`}>
              Публикации и обсуждения →
            </Link>
          </div>
        </aside>
        <div className="watch-anime-hero-copy">
          <div className="anime-title-media">
            <aside className="anime-trailer-panel" aria-label="Трейлер и оценки">
              <AnimeTrailer key={anime.id} urls={details?.trailerUrls ?? []} />
              <AnimeRatings anime={anime} />
            </aside>
            <div className="anime-title-copy">
              <p className="anime-title-kicker">
                {anime.year > 0 && <span>{anime.year}</span>}
                <span>{formatLabels[anime.format ?? "unknown"]}</span>
                <span className={`anime-status ${anime.status}`}>{status}</span>
                {!!count && <span>{count} эп.</span>}
              </p>
              <h1>
                {anime.title}
                {initialEpisode ? ` — серия ${initialEpisode.number}` : ""}
              </h1>
              <p className="anime-original-title">{anime.originalTitle}</p>
              <section className="anime-synopsis" id="anime-description">
                <h2>Описание</h2>
                <p>
                  {anime.description.length > 620
                    ? anime.description.slice(0, 620).replace(/\s\S*$/, "") + "…"
                    : anime.description || "Описание пока не добавлено."}
                </p>
                {anime.description.length > 620 && (
                  <details>
                    <summary>Читать полностью</summary>
                    <p>{anime.description}</p>
                  </details>
                )}
              </section>
            </div>
          </div>
          <div className="watch-anime-meta" aria-label="Жанры аниме">
            {anime.genres.map((genre) => (
              <Link key={genre} href={`/catalog/genres/${encodeURIComponent(genre)}`}>
                {genre}
              </Link>
            ))}
          </div>
          <section className="anime-information" aria-label="Информация об аниме">
            <h2>Информация</h2>
            <dl className="anime-facts">
              <div>
                <dt>Тип</dt>
                <dd>
                  <Link href={`/catalog/all?format=${anime.format ?? ""}`}>
                    {formatLabels[anime.format ?? "unknown"]}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Год выпуска</dt>
                <dd>
                  {anime.year > 0 ? (
                    <Link href={`/catalog/all?from=${anime.year}&to=${anime.year}`}>
                      {anime.year}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Статус</dt>
                <dd>
                  <Link
                    href={`/catalog/${anime.status === "ongoing" ? "ongoing" : anime.status === "announced" ? "announced" : "completed"}`}
                  >
                    {status}
                  </Link>
                </dd>
              </div>
              {!!count && (
                <div>
                  <dt>Эпизоды</dt>
                  <dd>
                    {anime.status === "ongoing" && details?.episodesTotal
                      ? `${details.episodesAired ?? 0} / ${details.episodesTotal}`
                      : count}
                  </dd>
                </div>
              )}
              {!!details?.duration && (
                <div>
                  <dt>Длительность</dt>
                  <dd>{details.duration} мин.</dd>
                </div>
              )}
              {!!details?.studios?.length && (
                <div>
                  <dt>Студия</dt>
                  <dd>{details.studios.join(", ")}</dd>
                </div>
              )}
              {!!details?.airedAt && (
                <div>
                  <dt>Премьера</dt>
                  <dd>{new Date(details.airedAt).toLocaleDateString("ru-RU")}</dd>
                </div>
              )}
              {!!details?.releasedAt && (
                <div>
                  <dt>Завершение</dt>
                  <dd>{new Date(details.releasedAt).toLocaleDateString("ru-RU")}</dd>
                </div>
              )}
              {!!details?.ageRating && (
                <div>
                  <dt>Возраст</dt>
                  <dd>{details.ageRating}</dd>
                </div>
              )}
              {!!anime.aliases.length && (
                <div className="anime-fact-aliases">
                  <dt>Другие названия</dt>
                  <dd>{anime.aliases.join(" · ")}</dd>
                </div>
              )}
            </dl>
            {details?.nextEpisodeAt && (
              <p className="anime-next-release">
                Следующая серия:{" "}
                <time dateTime={details.nextEpisodeAt}>
                  {new Date(details.nextEpisodeAt).toLocaleString("ru-RU", {
                    timeZone: "Europe/Kyiv",
                  })}
                </time>
              </p>
            )}
          </section>
          {process.env.DEMO_CATALOG === "true" && (
            <p className="preview-note">
              Страница из тестового каталога. Серии доступны у аниме из подключённого каталога.
            </p>
          )}
        </div>
      </div>
      <AnimeCharacters characters={characters} />
      <AnimeScreenshots images={details?.screenshots ?? []} title={anime.title} />
      <AnimeWatch
        resumeRequested={resumeRequested}
        key={anime.id}
        anime={anime}
        franchise={franchise}
        {...(initialEpisode ? { initialEpisode } : {})}
        {...(initialTime === undefined ? {} : { initialTime })}
      />
      <section id="anime-comments">
        <CommentsPanel
          key={anime.id + (initialEpisode?.id ?? "")}
          target={initialEpisode ? { episodeId: initialEpisode.id } : { animeId: anime.id }}
          context={{
            anime: { id: anime.id, slug: anime.slug, title: anime.title },
            ...(initialEpisode ? { episodeId: initialEpisode.id } : {}),
          }}
          title={
            initialEpisode ? `Комментарии к серии ${initialEpisode.number}` : "Комментарии к аниме"
          }
        />
      </section>
    </article>
  );
}
