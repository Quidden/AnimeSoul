import type { Metadata } from "next";
import { CommunityHub } from "../../components/CommunityHub";
import { contentQuerySchema } from "@animesoul/contracts";
import type { CommunityFilters } from "../../lib/community-feed";
export const metadata: Metadata = { title: "Сообщество", robots: { index: false, follow: false } };
export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams,
    section = q.tab === "reviews" || q.tab === "comments" ? q.tab : "posts",
    filters: CommunityFilters = { section, sort: "new" };
  for (const key of ["sort", "tag", "q", "kind", "animeId"] as const) {
    const parsed = contentQuerySchema.safeParse({ [key]: q[key] });
    if (parsed.success && parsed.data[key] !== undefined)
      Object.assign(filters, { [key]: parsed.data[key] });
  }
  if (section === "reviews") delete filters.kind;
  if (section === "comments") {
    delete filters.kind;
    delete filters.tag;
    filters.sort = "new";
  }
  return (
    <div className="account-page community-page">
      <CommunityHub key={JSON.stringify(filters)} {...filters} />
    </div>
  );
}
