import type { Metadata } from "next";
import { animeMetadata, animeStructuredData } from "../../../../../lib/anime-seo";
import { notFound } from "next/navigation";
import { z } from "zod";
import { timestampSchema } from "@animesoul/contracts";
import { getAnime, getAnimeCharacters, getEpisode, getFranchise } from "../../../../../lib/api";
import { safeJsonLd } from "../../../../../lib/site";
import { AnimeDetailPage } from "../../../../../components/AnimeDetailPage";
type Props = {
  params: Promise<{ slug: string; episodeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
async function content(params: Props["params"]) {
  const { slug, episodeId } = await params;
  if (!z.uuid().safeParse(episodeId).success) return null;
  const [anime, episode] = await Promise.all([getAnime(slug), getEpisode(slug, episodeId)]);
  return anime && episode ? { anime, episode } : null;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const value = await content(params);
  if (!value) return { title: "Серия не найдена", robots: { index: false, follow: false } };
  const { anime, episode } = value;
  return animeMetadata(anime, episode);
}
export default async function EpisodePage({ params, searchParams }: Props) {
  const value = await content(params);
  if (!value) notFound();
  const { anime, episode } = value,
    query = await searchParams;
  const timestamp = query.t === undefined ? 0 : timestampSchema.safeParse(query.t);
  if (typeof timestamp !== "number" && !timestamp.success) notFound();
  const start = typeof timestamp === "number" ? timestamp : timestamp.data;
  if (episode.duration && start > episode.duration) notFound();
  const [cast, franchise] = await Promise.all([
    getAnimeCharacters(anime.slug),
    getFranchise(anime.slug),
  ]);
  if (!franchise || franchise.currentAnimeId !== anime.id) notFound();
  return (
    <>
      <AnimeDetailPage
        anime={anime}
        franchise={franchise}
        characters={cast.items}
        initialEpisode={episode}
        resumeRequested={query.resume === "1"}
        {...(query.t === undefined ? {} : { initialTime: start })}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(animeStructuredData(anime, episode)),
        }}
      />
    </>
  );
}
