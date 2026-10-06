import Link from "next/link";
import { getCatalog } from "../lib/api";
import { AnimeCard } from "../components/AnimeCard";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  const catalog = await getCatalog();
  return (
    <div className="content">
      {catalog.source === "development" && (
        <p className="preview-note">Предпросмотр нового сайта · тестовый каталог</p>
      )}
      <section className="home-intro">
        <p className="eyebrow">ВАШ МИР АНИМЕ</p>
        <h1>
          Каждая история
          <br />
          оставляет <em>след.</em>
        </h1>
        <p>
          Открывайте новые миры и возвращайтесь к любимым. Всё, что хочется посмотреть, — рядом.
        </p>
        <Link className="button" href="/catalog">
          Открыть каталог <span>↗</span>
        </Link>
      </section>
      <section aria-labelledby="stories">
        <div className="section-heading">
          <h2 id="stories">Истории для вас</h2>
          <Link href="/catalog">Все аниме →</Link>
        </div>
        <div className="anime-grid">
          {catalog.items.map((anime, i) => (
            <AnimeCard key={anime.id} anime={anime} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
