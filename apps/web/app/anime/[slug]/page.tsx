import type { Metadata } from "next";
import { animeMetadata, animeStructuredData } from "../../../lib/anime-seo";
import { notFound, redirect } from "next/navigation";
import { getAnime, getAnimeCharacters, getFranchise } from "../../../lib/api";
import { AnimeDetailPage } from "../../../components/AnimeDetailPage";
import { safeJsonLd } from "../../../lib/site";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const anime = await getAnime(slug);
  if (!anime) return { title: "Аниме не найдено", robots: { index: false } };
  return animeMetadata(anime);
}
export default async function AnimePage({ params }: Props) {
  const { slug } = await params;
  const [anime, cast, franchise] = await Promise.all([
    getAnime(slug),
    getAnimeCharacters(slug),
    getFranchise(slug),
  ]);
  if (!anime || !franchise) notFound();
  if (franchise.currentAnimeId !== anime.id) {
    const current = franchise.items.find((part) => part.anime.id === franchise.currentAnimeId);
    if (!current) notFound();
    redirect(`/anime/${current.anime.slug}`);
  }
  return (
    <>
      <AnimeDetailPage anime={anime} franchise={franchise} characters={cast.items} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(animeStructuredData(anime)),
        }}
      />
    </>
  );
}
