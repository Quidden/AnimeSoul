import { AnimeAnnouncements } from "./SiteExperience";
import Link from "next/link";
import type { Anime, AnimeCharacter, AnimeFranchise, Episode } from "@animesoul/contracts";
import { AnimeBackdrop } from "./AnimeBackdrop";
import { AnimeCharacters } from "./AnimeCharacters";
import { AnimeDescription } from "./AnimeDescription";
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
import { trailerEmbed } from "../lib/trailer";

// Everything about the title sits above the player: poster, synopsis and a row of facts, then tabs
// with frames, trailer and characters. Under the player there are only episodes and comments.
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
  const screenshots = details?.screenshots ?? [];
  const trailer = Boolean(details?.trailerUrls?.some(trailerEmbed));
  return (
    <article className="watch-shell anime-detail-page">
      {backdrop && <AnimeBackdrop src={backdrop} />}
      <nav className="anime-breadcrumb" aria-label="Навигационная цепочка">
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span>{anime.title}</span>
      </nav>
      <AnimeAnnouncements animeId={anime.id} />
      <section
        className="anime-hero"
        id="anime-about"
        aria-label="О тайтле"
        data-compass="О тайтле"
      >
        <aside className="anime-hero-rail">
          {anime.poster ? (
            <img
              className="anime-hero-poster"
              src={anime.poster}
              alt={`Постер: ${anime.title}`}
              width="270"
              height="405"
            />
          ) : (
            <div className="anime-hero-poster anime-hero-poster-empty">
              <Icon name="image" />
            </div>
          )}
          <div className="watch-poster-actions">
            <AnimeWatchStart animeId={anime.id} />
            <AnimeLibraryActions key={anime.id} animeId={anime.id} />
          </div>
        </aside>
        <header className="anime-hero-head">
          <p className="anime-title-kicker">
            {anime.year > 0 && <span>{anime.year}</span>}
            <span>{formatLabels[anime.format ?? "unknown"]}</span>
            <span className={`anime-status ${anime.status}`}>{status}</span>
            {!!count && <span>{count} эп.</span>}
          </p>
          <h1>{anime.title}</h1>
          {!!anime.originalTitle && <p className="anime-original-title">{anime.originalTitle}</p>}
          <AnimeRatings anime={anime} />
        </header>
        <div className="anime-hero-body">
          {!!anime.genres.length && (
            <div className="watch-anime-meta" aria-label="Жанры аниме">
              {anime.genres.map((genre) => (
                <Link key={genre} href={`/catalog/genres/${encodeURIComponent(genre)}`}>
                  {genre}
                </Link>
              ))}
            </div>
          )}
          <AnimeDescription text={description} />
          <dl className="anime-facts" aria-label="Информация об аниме">
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
          </dl>
          {!!anime.aliases.length && (
            <p className="anime-aliases">
              <span>Другие названия:</span> {anime.aliases.join(" · ")}
            </p>
          )}
          <AnimeReleaseSchedule releases={releases} initialNow={releaseNow} />
          <p className="anime-hero-links">
            {franchise.items.length > 1 && (
              <Link href={`/anime/${anime.slug}/franchise`}>
                Карта франшизы · {franchise.items.length} →
              </Link>
            )}
            <Link href={`/anime/${anime.slug}/community`}>Публикации и обсуждения →</Link>
          </p>
          {process.env.DEMO_CATALOG === "true" && (
            <p className="preview-note">
              Страница из тестового каталога. Серии доступны у аниме из подключённого каталога.
            </p>
          )}
        </div>
      </section>
      <AnimeSections
        sections={[
          ...(screenshots.length || trailer
            ? [
                {
                  id: "media",
                  label:
                    screenshots.length && trailer
                      ? "Кадры и трейлер"
                      : trailer
                        ? "Трейлер"
                        : "Кадры",
                  ...(screenshots.length ? { count: screenshots.length } : {}),
                  content: (
                    // With a trailer: the video and four frames side by side, the rest in the lightbox.
                    <div className={`anime-media-panel${trailer ? " has-trailer" : ""}`}>
                      {trailer && <AnimeTrailer key={anime.id} urls={details?.trailerUrls ?? []} />}
                      {!!screenshots.length && (
                        <AnimeScreenshots
                          images={screenshots}
                          title={anime.title}
                          {...(trailer ? { limit: 4 } : {})}
                        />
                      )}
                    </div>
                  ),
                },
              ]
            : []),
          ...(characters.length
            ? [
                {
                  id: "characters",
                  label: "Персонажи",
                  count: characters.length,
                  content: <AnimeCharacters characters={characters} />,
                },
              ]
            : []),
        ]}
      />
      {initialEpisode && <ScrollToWatch />}
      <AnimeWatch
        resumeRequested={resumeRequested}
        key={anime.id}
        anime={anime}
        franchise={franchise}
        {...(initialEpisode ? { initialEpisode } : {})}
        {...(initialTime === undefined ? {} : { initialTime })}
      />
      <section className="anime-comments" id="anime-comments" data-compass="Комментарии">
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
