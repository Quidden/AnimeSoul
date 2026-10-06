import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnime } from "../../../lib/api";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";
import { Icon } from "../../../components/Icon";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const anime = await getAnime(slug);
  if (!anime) return { title: "Аниме не найдено", robots: { index: false } };
  return {
    title: `${anime.title} — описание и информация`,
    robots: {
      index: siteConfiguration().indexable && anime.indexable,
      follow: siteConfiguration().indexable,
    },
    description: anime.description,
    alternates: { canonical: `/anime/${anime.slug}` },
    openGraph: {
      title: anime.title,
      description: anime.description,
      type: "website",
      url: `/anime/${anime.slug}`,
    },
  };
}
export default async function AnimePage({ params }: Props) {
  const { slug } = await params;
  const anime = await getAnime(slug);
  if (!anime) notFound();
  const url = new URL(`/anime/${anime.slug}`, siteConfiguration().url).href;
  return (
    <article className="watch-shell anime-detail-page">
      <nav className="anime-breadcrumb" aria-label="Навигационная цепочка">
        <Link href="/">Главная</Link>
        <span>/</span>
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span>{anime.title}</span>
      </nav>
      <div className="watch-anime-hero">
        <aside className="watch-anime-rail">
          {anime.poster ? (
            <img src={anime.poster} alt={`Постер: ${anime.title}`} width="270" height="405" />
          ) : (
            <div className="watch-anime-poster-empty">
              <Icon name="image" />
            </div>
          )}
        </aside>
        <div className="watch-anime-hero-copy">
          <p className="eyebrow">
            {anime.year} ·{" "}
            {anime.status === "released"
              ? "ВЫШЛО"
              : anime.status === "ongoing"
                ? "ОНГОИНГ"
                : "АНОНС"}
          </p>
          <h1>{anime.title}</h1>
          <p className="anime-original-title">{anime.originalTitle}</p>
          <div className="watch-anime-meta">
            {anime.genres.map((genre) => (
              <Link key={genre} href={`/catalog?genre=${encodeURIComponent(genre)}`}>
                {genre}
              </Link>
            ))}
          </div>
          <section className="anime-information" aria-label="Информация об аниме">
            <dl className="anime-facts">
              <div>
                <dt>Год выпуска</dt>
                <dd>{anime.year}</dd>
              </div>
              <div>
                <dt>Статус</dt>
                <dd>
                  {anime.status === "released"
                    ? "Вышло"
                    : anime.status === "ongoing"
                      ? "Онгоинг"
                      : "Анонс"}
                </dd>
              </div>
              <div>
                <dt>Другие названия</dt>
                <dd>{anime.aliases.join(" · ")}</dd>
              </div>
            </dl>
          </section>
          <section className="anime-synopsis">
            <h2>Описание</h2>
            <p>{anime.description}</p>
          </section>
          {process.env.DEMO_CATALOG === "true" && (
            <p className="preview-note">
              Страница из тестового каталога. Подключение плеера — следующий этап переноса.
            </p>
          )}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd({
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            name: anime.title,
            alternateName: [anime.originalTitle, ...anime.aliases],
            description: anime.description,
            url,
            inLanguage: "ru",
          }),
        }}
      />
    </article>
  );
}
