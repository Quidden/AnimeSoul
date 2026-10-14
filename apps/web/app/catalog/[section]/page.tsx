import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "../../../components/CatalogView";
import { catalogSections, type CatalogSearch } from "../../../lib/catalog-filters";
import { siteConfiguration } from "../../../lib/site";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ section: string }>; searchParams: Promise<CatalogSearch> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { section } = await params,
    selected = catalogSections.find((s) => s.key === section),
    search = await searchParams;
  return {
    title: selected ? `${selected.title} — аниме` : "Раздел не найден",
    alternates: { canonical: "/catalog/" + section },
    robots: {
      index:
        Boolean(selected) &&
        section !== "for-you" &&
        siteConfiguration().indexable &&
        !Object.values(search).some(Boolean),
      follow: siteConfiguration().indexable,
    },
  };
}
export default async function Page({ params, searchParams }: Props) {
  const { section } = await params;
  if (!catalogSections.some((s) => s.key === section)) notFound();
  return <CatalogView section={section} search={await searchParams} />;
}
