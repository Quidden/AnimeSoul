import type { Metadata } from "next";
import { getCatalog } from "../../lib/api";
import { siteConfiguration } from "../../lib/site";
import { AnimeCard } from "../../components/AnimeCard";
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: "Каталог аниме",
    alternates: { canonical: "/catalog" },
    robots: { index: siteConfiguration().indexable && !q, follow: siteConfiguration().indexable },
  };
}
export default async function CatalogPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const catalog = await getCatalog(q);
  return (
    <div className="content catalog-page">
      <p className="eyebrow">ОТКРЫВАЙТЕ НОВОЕ</p>
      <h1>Каталог аниме</h1>
      <form className="search" action="/catalog" role="search">
        <label htmlFor="q">Название аниме</label>
        <div>
          <input
            id="q"
            name="q"
            maxLength={100}
            defaultValue={q}
            placeholder="Например, Атака титанов"
          />
          <button type="submit">Найти →</button>
        </div>
      </form>
      {catalog.source === "development" && (
        <p className="preview-note">Тестовый каталог · {catalog.items.length} тайтла</p>
      )}
      {catalog.items.length ? (
        <div className="anime-grid">
          {catalog.items.map((anime, i) => (
            <AnimeCard key={anime.id} anime={anime} index={i} />
          ))}
        </div>
      ) : (
        <p className="empty-state">
          По этому названию ничего не найдено. Попробуйте другое написание.
        </p>
      )}
    </div>
  );
}
