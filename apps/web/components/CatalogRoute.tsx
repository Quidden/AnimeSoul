import type { Metadata } from "next";
import { CatalogView } from "./CatalogView";
import type { CatalogSearch } from "../lib/catalog-filters";
import { siteConfiguration } from "../lib/site";
type Props = { searchParams: Promise<CatalogSearch> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const search = await searchParams;
  return {
    title: "Каталог аниме",
    alternates: { canonical: "/catalog" },
    robots: {
      index: siteConfiguration().indexable && !Object.values(search).some(Boolean),
      follow: siteConfiguration().indexable,
    },
  };
}
export default async function CatalogPage({ searchParams }: Props) {
  return <CatalogView search={await searchParams} />;
}
