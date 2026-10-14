import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCharacter } from "../../../lib/api";
import { siteConfiguration } from "../../../lib/site";
import { CharacterDetailPage } from "../../../components/CharacterDetailPage";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const character = await getCharacter(slug);
  if (!character) return { title: "Персонаж не найден", robots: { index: false } };
  const text = character.description.replace(/\s+/g, " ").trim();
  const description = text
    ? text.length > 165
      ? text.slice(0, 162).replace(/\s\S*$/, "") + "…"
      : text
    : `${character.name}: описание, сэйю, роли и аниме с персонажем на AnimeSoul.`;
  const title = `${character.name} — персонаж`;
  const url = `/characters/${character.slug}`;
  const images = character.image ? [{ url: character.image, alt: character.name }] : [];
  const site = siteConfiguration();
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: site.indexable, follow: site.indexable },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images,
      locale: "ru_RU",
      siteName: "AnimeSoul",
    },
    twitter: { card: "summary", title, description, images },
  };
}

export default async function CharacterPage({ params }: Props) {
  const { slug } = await params;
  const character = await getCharacter(slug);
  if (!character) notFound();
  return <CharacterDetailPage character={character} />;
}
