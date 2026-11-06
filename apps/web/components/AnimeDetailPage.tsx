import { AnimeAnnouncements } from "./SiteExperience";
import Link from "next/link";
import type { Anime, AnimeCharacter, AnimeFranchise, Episode } from "@animesoul/contracts";
import { AnimeCharacters } from "./AnimeCharacters";
import { AnimeLibraryActions } from "./AnimeLibraryActions";
import { AnimeRatings } from "./AnimeRatings";
import { AnimeReleaseSchedule } from "./AnimeReleaseSchedule";
import { AnimeTrailer } from "./AnimeTrailer";
import { AnimeWatch } from "./AnimeWatch";
import { AnimeWatchStart } from "./AnimeWatchStart";
import { ScrollToWatch } from "./ScrollToWatch";
import { CommentsPanel } from "./ContentPanels";
import { AnimeScreenshots } from "./AnimeScreenshots";
import { AnimeSections } from "./AnimeSections";
import { Icon } from "./Icon";
import { formatLabels } from "../lib/catalog-filters";
import { animeReleases } from "../lib/anime-releases";
import { plainDescription } from "../lib/description-text";

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
  const description = plainDescription(anime.description);
  const releaseNow = Date.now();
  const releases = animeReleases(anime, franchise, releaseNow);
  const backdrop = details?.screenshots?.[0] ?? anime.poster;
  return (
    <article className="watch-shell anime-detail-page">
      {backdrop && (
        <div className="anime-backdrop" aria-hidden="true">
          <img src={backdrop} alt="" />
        </div>
      )}
      <nav className="anime-breadcrumb" aria-label="Навигационная цепочка">
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span>{anime.title}</span>
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
            <AnimeWatchStart animeId={anime.id} />
            <AnimeLibraryActions key={anime.id} animeId={anime.id} />
          </div>
        </aside>
        <div className="watch-anime-hero-copy">
          <p className="anime-title-kicker">
            {anime.year > 0 && <span>{anime.year}</span>}
            <span>{formatLabels[anime.format ?? "unknown"]}</span>
            <span className={`anime-status ${anime.status}`}>{status}</span>
            {!!count && <span>{count} эп.</span>}
            {!!details?.studios?.[0] && <span>{details.studios[0]}</span>}
            {!!details?.ageRating && <span>{details.ageRating}</span>}
          </p>
          <h1>{anime.title}</h1>
          <p className="anime-original-title">{anime.originalTitle}</p>
          <AnimeRatings anime={anime} />
          <div className="watch-anime-meta" aria-label="Жанры аниме">
            {anime.genres.map((genre) => (
              <Link key={genre} href={`/catalog/genres/${encodeURIComponent(genre)}`}>
                {genre}
              </Link>
            ))}
          </div>
          {!!description && (
            <p className="anime-teaser">
              {description.length > 260
                ? description.slice(0, 260).replace(/\s\S*$/, "") + "…"
                : description}{" "}
              <a href="#anime-description">Всё описание ↓</a>
            </p>
          )}
          <p className="anime-hero-links">
            {franchise.items.length > 1 && (
              <Link href={`/anime/${anime.slug}/franchise`}>
                Карта франшизы · {franchise.items.length} →
              </Link>
            )}
            <Link href={`/anime/${anime.slug}/community`}>Публикации и обсуждения →</Link>
          </p>
        </div>
      </div>
      {initialEpisode && <ScrollToWatch />}
      {/* The player comes right after the title; everything else sits in tabs under it. */}
      <AnimeWatch
        resumeRequested={resumeRequested}
        key={anime.id}
        anime={anime}
        franchise={franchise}
        {...(initialEpisode ? { initialEpisode } : {})}
        {...(initialTime === undefined ? {} : { initialTime })}
      />
      <AnimeSections
        sections={[
          {
            id: "description",
            label: "Описание",
            content: (
              <section className="anime-synopsis" id="anime-description">
                <h2>Описание</h2>
                <p>{description || "Описание пока не добавлено."}</p>
              </section>
            ),
          },
          {
            id: "information",
            label: "Информация",
            content: (
              <div className="anime-about">
                <AnimeReleaseSchedule releases={releases} initialNow={releaseNow} />
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
                </section>
                {process.env.DEMO_CATALOG === "true" && (
                  <p className="preview-note">
                    Страница из тестового каталога. Серии доступны у аниме из подключённого
                    каталога.
                  </p>
                )}
              </div>
            ),
          },
          {
            id: "characters",
            label: "Персонажи",
            count: characters.length,
            content: <AnimeCharacters characters={characters} />,
          },
          ...(details?.screenshots?.length
            ? [
                {
                  id: "screenshots",
                  label: "Кадры",
                  count: details.screenshots.length,
                  content: <AnimeScreenshots images={details.screenshots} title={anime.title} />,
                },
              ]
            : []),
          ...(details?.trailerUrls?.length
            ? [
                {
                  id: "trailer",
                  label: "Трейлер",
                  content: <AnimeTrailer key={anime.id} urls={details.trailerUrls} />,
                },
              ]
            : []),
          {
            id: "comments",
            label: "Комментарии",
            content: (
              <section id="anime-comments">
                <CommentsPanel
                  key={anime.id + (initialEpisode?.id ?? "")}
                  target={initialEpisode ? { episodeId: initialEpisode.id } : { animeId: anime.id }}
                  context={{
                    anime: { id: anime.id, slug: anime.slug, title: anime.title },
                    ...(initialEpisode ? { episodeId: initialEpisode.id } : {}),
                  }}
                  title={
                    initialEpisode
                      ? `Комментарии к серии ${initialEpisode.number}`
                      : "Комментарии к аниме"
                  }
                />
              </section>
            ),
          },
        ]}
      />
    </article>
  );
}
