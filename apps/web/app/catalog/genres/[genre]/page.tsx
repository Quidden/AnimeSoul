import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CatalogView } from "../../../../components/CatalogView";
import type { CatalogSearch } from "../../../../lib/catalog-filters";
import { siteConfiguration } from "../../../../lib/site";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ genre: string }>; searchParams: Promise<CatalogSearch> };
function validateGenre(genre: string) {
  if (genre.length > 100 || !genre.trim()) notFound();
  return genre;
}
function decodeGenre(value: string) {
  let genre: string;
  try {
    genre = decodeURIComponent(value);
  } catch {
    notFound();
  }
  return validateGenre(genre);
}
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  // Next supplies decoded metadata params, while page params are URL-encoded.
  const genre = validateGenre((await params).genre);
  return {
    title: `${genre} — аниме`,
    alternates: { canonical: "/catalog/genres/" + encodeURIComponent(genre) },
    robots: {
      index: siteConfiguration().indexable && !Object.values(await searchParams).some(Boolean),
      follow: siteConfiguration().indexable,
    },
  };
}
export default async function Page({ params, searchParams }: Props) {
  const genre = decodeGenre((await params).genre);
  const search = await searchParams;
  if (typeof search.genre === "string" && search.genre.trim() !== genre) {
    const selected = search.genre.trim();
    if (selected.length > 100) notFound();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search))
      if (key !== "genre" && typeof value === "string") query.set(key, value);
    const base = selected ? "/catalog/genres/" + encodeURIComponent(selected) : "/catalog/all";
    redirect(base + (query.size ? "?" + query : ""));
  }
  return <CatalogView genre={genre} search={search} />;
}
