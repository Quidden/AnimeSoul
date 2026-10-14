import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAnimeCharacters, getAnime, getFranchise } from "../../../../lib/api";
import { FranchiseGraph } from "../../../../components/FranchiseGraph";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const anime = await getAnime((await params).slug);
  return {
    title: anime ? `${anime.title} — карта франшизы` : "Франшиза не найдена",
    robots: { index: false },
  };
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  await getAnimeCharacters(slug);
  const franchise = await getFranchise(slug);
  if (!franchise) notFound();
  return (
    <section className="anime-franchise-page">
      <FranchiseGraph key={franchise.currentAnimeId} franchise={franchise} />
    </section>
  );
}
