import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnime } from "../../../lib/api";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";
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
    <article className="content anime-detail">
      <Link className="back-link" href="/catalog">
        ← Каталог
      </Link>
      <p className="eyebrow">
        {anime.year} <span> / </span> {anime.genres.join(" · ")}
      </p>
      <h1>{anime.title}</h1>
      <p className="original-title">{anime.originalTitle}</p>
      <div className="detail-divider" />
      <section>
        <h2>О чём история</h2>
        <p className="synopsis">{anime.description}</p>
      </section>
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
