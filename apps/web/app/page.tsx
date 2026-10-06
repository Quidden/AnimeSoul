import Link from "next/link";
import { getCatalog } from "../lib/api";
import { AnimeCard } from "../components/AnimeCard";
import { Icon } from "../components/Icon";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  const catalog = await getCatalog();
  return (
    <>
      <section className="home-cinema-hero empty-resume" aria-label="Выбрать что посмотреть">
        <div className="home-cinema-media" aria-hidden="true">
          <span className="home-cinema-placeholder">AnimeSoul</span>
        </div>
        <div className="home-cinema-vignette" />
        <div className="home-cinema-copy">
          <p className="eyebrow hero-resume-label">ВЫБРАТЬ ЧТО ПОСМОТРЕТЬ</p>
          <h1>
            Твоя коллекция.
            <br />
            <i>Твои правила.</i>
          </h1>
          <p>
            Выбери первое аниме в каталоге. Здесь появится продолжение просмотра, а фон подстроится
            под его постер.
          </p>
          <Link className="home-cinema-cta" href="/catalog">
            <Icon name="search" />
            Открыть каталог
          </Link>
        </div>
      </section>
      <div className="home-library-workspace">
        <section className="home-watching">
          <div className="home-library-heading">
            <h2>Смотрю сейчас</h2>
          </div>
          <p className="empty-state">Здесь появятся аниме, к которым ты захочешь вернуться.</p>
        </section>
        <section>
          <div className="home-library-heading">
            <h2>Каталог</h2>
            <Link className="text-link" href="/catalog">
              Смотреть всё →
            </Link>
          </div>
          <div className="cards">
            {catalog.items.slice(0, 6).map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
