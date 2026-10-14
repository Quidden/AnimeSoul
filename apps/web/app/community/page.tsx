import type { Metadata } from "next";
import { AdultContentPreference, PostsPanel } from "../../components/ContentPanels";
export const metadata: Metadata = { title: "Сообщество", robots: { index: false, follow: false } };
export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams,
    tag = typeof q.tag === "string" && /^[\p{L}\p{N}_]{1,40}$/u.test(q.tag) ? q.tag : undefined;
  return (
    <div className="account-page community-page">
      <p className="eyebrow">ANIMESOUL</p>
      <h1>Сообщество</h1>
      <p className="account-intro">Мысли об аниме, впечатления от серий и разговоры с друзьями.</p>
      <AdultContentPreference />
      <PostsPanel {...(tag ? { tag } : {})} />
    </div>
  );
}
