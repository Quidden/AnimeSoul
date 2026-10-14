import type { ReactNode } from "react";
import { getAnime } from "../../../lib/api";
import { trailerEmbed } from "../../../lib/trailer";
import { AnimeNavigation } from "../../../components/AnimeNavigation";
import { PosterAmbient } from "../../../components/PosterAmbient";

export default async function AnimeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const anime = await getAnime((await params).slug);
  if (!anime) return children;
  return (
    <div className="anime-page-layout">
      <PosterAmbient poster={anime.poster} />
      <AnimeNavigation
        slug={anime.slug}
        trailer={Boolean(anime.details?.trailerUrls?.some(trailerEmbed))}
      />
      {children}
    </div>
  );
}
