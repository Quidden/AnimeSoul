import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAnime } from "../../../../lib/api";
import { PostsPanel, CommentsPanel } from "../../../../components/ContentPanels";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const anime = await getAnime((await params).slug);
  return {
    title: anime ? `${anime.title} — публикации и обсуждения` : "Аниме не найдено",
    robots: { index: false },
  };
}
export default async function Page({ params }: Props) {
  const anime = await getAnime((await params).slug);
  if (!anime) notFound();
  return (
    <article className="library anime-community-page">
      <nav className="anime-breadcrumb">
        <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
        <span>/</span>
        <span>Сообщество</span>
      </nav>
      <h1>Публикации и обсуждения</h1>
      <p className="account-help">{anime.title} · впечатления, рецензии и обсуждения серий.</p>
      <nav className="anime-community-tabs" aria-label="Разделы сообщества аниме">
        <a className="outline" href="#profile-posts">
          Все публикации
        </a>
        <a className="outline" href="#profile-reviews">
          Рецензии
        </a>
        <a className="outline" href="#profile-comments">
          Комментарии
        </a>
        <Link className="outline" href={`/anime/${anime.slug}`}>
          Вернуться к просмотру
        </Link>
      </nav>
      <PostsPanel
        context={{
          animeId: anime.id,
          title: anime.title,
          anime: { id: anime.id, slug: anime.slug, title: anime.title },
        }}
      />
      <PostsPanel
        section="reviews"
        context={{
          animeId: anime.id,
          title: anime.title,
          anime: { id: anime.id, slug: anime.slug, title: anime.title },
        }}
      />
      <CommentsPanel
        target={{ animeId: anime.id }}
        context={{ anime: { id: anime.id, slug: anime.slug, title: anime.title } }}
        title="Обсуждение аниме и серий"
        allDiscussions
      />
    </article>
  );
}
