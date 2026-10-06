import type { Metadata } from "next";
import Link from "next/link";
import { getCatalog } from "../../lib/api";
import { siteConfiguration } from "../../lib/site";
import { AnimeCard } from "../../components/AnimeCard";

export const dynamic = "force-dynamic";
type Search = {
  q?: string;
  genre?: string;
  status?: string;
  sort?: string;
  from?: string;
  to?: string;
};
type Props = { searchParams: Promise<Search> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return {
    title: "Каталог аниме",
    alternates: { canonical: "/catalog" },
    robots: {
      index: siteConfiguration().indexable && !Object.values(params).some(Boolean),
      follow: siteConfiguration().indexable,
    },
  };
}
function year(value: string | undefined) {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  const result = Number(value);
  return result >= 1900 && result <= 2200 ? result : undefined;
}
export default async function CatalogPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const [catalog, filterCatalog] = await Promise.all([
    getCatalog(q),
    q ? getCatalog() : Promise.resolve(null),
  ]);
  const genres = [
    ...new Set((filterCatalog ?? catalog).items.flatMap((anime) => anime.genres)),
  ].sort();
  const genre = genres.includes(params.genre ?? "") ? params.genre! : "";
  const from = year(params.from);
  const to = year(params.to);
  const status = ["released", "ongoing", "announced"].includes(params.status ?? "")
    ? params.status!
    : "";
  const sort = ["newest", "oldest", "title"].includes(params.sort ?? "") ? params.sort! : "title";
  const query = q.toLocaleLowerCase();
  const visible = catalog.items
    .filter(
      (anime) =>
        (!query ||
          [anime.title, anime.originalTitle, ...anime.aliases].some((title) =>
            title.toLocaleLowerCase().includes(query),
          )) &&
        (!genre || anime.genres.includes(genre)) &&
        (!status || anime.status === status) &&
        (!from || anime.year >= from) &&
        (!to || anime.year <= to),
    )
    .sort((a, b) =>
      sort === "newest"
        ? b.year - a.year
        : sort === "oldest"
          ? a.year - b.year
          : a.title.localeCompare(b.title, "ru"),
    );
  return (
    <section className="library catalog-page" id="catalog">
      <div className="section-head">
        <div>
          <h1>Каталог</h1>
          <p className="catalog-result-count">
            Найдено: {visible.length}
            {catalog.source === "development" ? " · тестовый каталог" : ""}
          </p>
        </div>
        <Link className="outline" href="/">
          ← На главную
        </Link>
      </div>
      <div className="catalog-layout">
        <aside className="catalog-controls" aria-label="Фильтры каталога">
          <form className="filter-panel" action="/catalog">
            <div className="filter-heading">
              <span>Фильтры каталога</span>
              <Link href="/catalog">Сбросить</Link>
            </div>
            <label>
              Название
              <input type="search" name="q" maxLength={100} defaultValue={q} placeholder="Аниме…" />
            </label>
            <label>
              Сортировка
              <select name="sort" defaultValue={sort}>
                <option value="title">По названию</option>
                <option value="newest">Сначала новые</option>
                <option value="oldest">Сначала старые</option>
              </select>
            </label>
            <label>
              Жанр
              <select name="genre" defaultValue={genre}>
                <option value="">Все жанры</option>
                {genres.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Статус
              <select name="status" defaultValue={status}>
                <option value="">Любой статус</option>
                <option value="released">Вышло</option>
                <option value="ongoing">Онгоинг</option>
                <option value="announced">Анонс</option>
              </select>
            </label>
            <label>
              Год от
              <input
                type="number"
                name="from"
                min="1900"
                max="2200"
                defaultValue={from}
                placeholder="Любой"
              />
            </label>
            <label>
              до
              <input
                type="number"
                name="to"
                min="1900"
                max="2200"
                defaultValue={to}
                placeholder="Любой"
              />
            </label>
            <button className="primary" type="submit">
              Применить
            </button>
          </form>
        </aside>
        <div className="catalog-content">
          <section className="catalog-recommendations" aria-label="Выбор аниме">
            <p className="eyebrow">ВЫБРАТЬ ЧТО ПОСМОТРЕТЬ</p>
            <h2>Что посмотреть?</h2>
            <p>Найди историю под своё настроение — выбери жанр или воспользуйся поиском.</p>
            <div className="genre-row">
              {genres.map((item) => (
                <Link
                  key={item}
                  href={`/catalog?genre=${encodeURIComponent(item)}`}
                  aria-current={genre === item ? "page" : undefined}
                >
                  {item}
                </Link>
              ))}
            </div>
          </section>
          <div className="catalog-shelf-heading">
            <h2>{q ? `Результаты поиска: ${q}` : genre || "Все аниме"}</h2>
            {(q || genre || status || from || to) && (
              <Link className="text-link" href="/catalog">
                Сбросить фильтры
              </Link>
            )}
          </div>
          {visible.length ? (
            <div className="cards">
              {visible.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} />
              ))}
            </div>
          ) : (
            <div className="catalog-empty">
              <p>По выбранным фильтрам ничего не найдено.</p>
              <Link href="/catalog" className="outline">
                Сбросить фильтры
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
