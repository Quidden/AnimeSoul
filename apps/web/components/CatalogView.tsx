import Link from "next/link";
import { getCatalog } from "../lib/api";
import { hasProfileSession } from "../lib/profile-viewer";
import {
  catalogFilters,
  catalogParameters,
  catalogSections,
  formatLabels,
  type CatalogSearch,
} from "../lib/catalog-filters";
import { AnimeCard } from "./AnimeCard";
import { CatalogShelf, RandomPicker, CatalogFilterDrawer } from "./CatalogInteractive";

export async function CatalogView({
  search,
  section,
  genre,
}: {
  search: CatalogSearch;
  section?: string;
  genre?: string;
}) {
  const selected = catalogSections.find((s) => s.key === section);
  const filters = catalogFilters(search, { ...selected?.filters, ...(genre ? { genre } : {}) });
  const base = genre
    ? "/catalog/genres/" + encodeURIComponent(genre)
    : selected
      ? "/catalog/" + selected.key
      : "/catalog";
  const personalized = filters.personalized === "1" || filters.ratingSource === "mine";
  const discovery =
    !section &&
    !genre &&
    !Object.entries(search).some(([key, value]) => key !== "page" && Boolean(value));
  const logged = personalized ? await hasProfileSession() : true;
  const catalog = logged ? await getCatalog(filters.q, { ...filters }).catch(() => null) : null;
  const shelves = discovery
    ? await Promise.all(
        catalogSections.slice(0, 4).map(async (shelf) => ({
          shelf,
          catalog: await getCatalog("", { ...shelf.filters, pageSize: 12 }).catch(() => null),
        })),
      )
    : [];
  const title = genre ?? selected?.title ?? "Каталог";
  const genres = catalog?.genres ?? [];
  const active = Object.entries(filters).filter(
    ([key, value]) =>
      !["q", "page", "pageSize", "sort", "personalized"].includes(key) &&
      value !== "" &&
      value !== undefined &&
      (key !== "ratingSource" || value !== "shikimori"),
  );
  function pageLink(page: number) {
    const params = catalogParameters({ ...filters, page });
    return base + "?" + params;
  }
  return (
    <section className="library catalog-page" id="catalog">
      <div className="section-head">
        <div>
          <p className="eyebrow">НАЙДИ СВОЮ ИСТОРИЮ</p>
          <h1>{title}</h1>
          <p className="catalog-result-count">
            {catalog
              ? `Найдено: ${catalog.total.toLocaleString("ru-RU")}`
              : personalized
                ? "Подбор по вашим просмотрам и оценкам"
                : "Каталог временно недоступен"}
          </p>
        </div>
      </div>
      <nav className="catalog-sections" aria-label="Разделы каталога">
        <Link href="/catalog" aria-current={discovery ? "page" : undefined}>
          Обзор
        </Link>
        {catalogSections.map((s) => (
          <Link
            key={s.key}
            href={"/catalog/" + s.key}
            aria-current={section === s.key ? "page" : undefined}
          >
            {s.title}
          </Link>
        ))}
      </nav>
      <div className="catalog-layout">
        <aside className="catalog-controls">
          <CatalogFilterDrawer count={active.length}>
            <form className="filter-panel" action={base} data-catalog-filters>
              <div className="filter-heading">
                <span>Уточнить выбор</span>
                <Link href={base}>Сбросить</Link>
              </div>
              <label>
                Название
                <input
                  type="search"
                  name="q"
                  maxLength={100}
                  defaultValue={filters.q}
                  placeholder="Аниме…"
                />
              </label>
              <label>
                Сортировка
                <select name="sort" defaultValue={filters.sort}>
                  <option value="popular">По популярности</option>
                  <option value="rating">Рейтинг: высокий</option>
                  <option value="rating-asc">Рейтинг: низкий</option>
                  <option value="newest">Сначала новые</option>
                  <option value="oldest">Сначала старые</option>
                  <option value="title">По названию</option>
                </select>
              </label>
              <label>
                Жанр
                <select name="genre" defaultValue={filters.genre}>
                  <option value="">Все жанры</option>
                  {genres.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label>
                Исключить жанр
                <select name="excludeGenre" defaultValue={filters.excludeGenre}>
                  <option value="">Не исключать</option>
                  {genres.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label>
                Группировка
                <select name="group" defaultValue={filters.group}>
                  <option value="">Франшизы и тайтлы</option>
                  <option value="franchise">Только франшизы</option>
                  <option value="standalone">Отдельные тайтлы</option>
                </select>
              </label>
              <label>
                Формат
                <select name="format" defaultValue={filters.format}>
                  {!selected?.filters || !("format" in selected.filters) ? (
                    <option value="">Все форматы</option>
                  ) : null}
                  {Object.entries(formatLabels)
                    .filter(
                      ([key]) =>
                        key !== "unknown" &&
                        (!selected?.filters ||
                          !("format" in selected.filters) ||
                          key === selected.filters.format),
                    )
                    .map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Статус
                <select name="status" defaultValue={filters.status}>
                  {[
                    { key: "", label: "Любой статус" },
                    { key: "released", label: "Завершённые" },
                    { key: "ongoing", label: "Выходит" },
                    { key: "announced", label: "Запланировано" },
                  ]
                    .filter(
                      (s) =>
                        !selected?.filters ||
                        !("status" in selected.filters) ||
                        s.key === selected.filters.status,
                    )
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Озвучка
                <select name="translation" defaultValue={filters.translation}>
                  <option value="">Все озвучки</option>
                  {catalog?.translations?.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Источник оценки
                <select name="ratingSource" defaultValue={filters.ratingSource}>
                  <option value="shikimori">Shikimori</option>
                  <option value="community">AnimeSoul</option>
                  <option value="mine">Моя оценка</option>
                </select>
              </label>
              <label>
                Рейтинг от
                <select name="minRating" defaultValue={filters.minRating ?? ""}>
                  <option value="">Любой</option>
                  {[5, 6, 7, 8, 9, 10].map((n) => (
                    <option value={n} key={n}>
                      {n}.0
                    </option>
                  ))}
                </select>
              </label>
              <div className="catalog-year-range">
                <label>
                  Год от
                  <input
                    type="number"
                    name="from"
                    min={1900}
                    max={2200}
                    defaultValue={filters.from}
                    placeholder="Любой"
                  />
                </label>
                <label>
                  до
                  <input
                    type="number"
                    name="to"
                    min={1900}
                    max={2200}
                    defaultValue={filters.to}
                    placeholder="Любой"
                  />
                </label>
              </div>
              {filters.personalized === "1" && (
                <input type="hidden" name="personalized" value="1" />
              )}
              <button type="submit" className="primary">
                Применить
              </button>
            </form>
          </CatalogFilterDrawer>
        </aside>
        <div className="catalog-content">
          <section className="catalog-recommendations" aria-label="Выбор аниме">
            <p className="eyebrow">ЧТО ПОСМОТРЕТЬ?</p>
            <h2>Новая история в один клик</h2>
            <RandomPicker filters={filters} />
            <div className="genre-row">
              {[
                "Экшен",
                "Приключения",
                "Комедия",
                "Драма",
                "Фэнтези",
                "Романтика",
                "Повседневность",
                "Сёнен",
              ]
                .filter((g) => genres.includes(g))
                .map((g) => (
                  <Link href={"/catalog/genres/" + encodeURIComponent(g)} key={g}>
                    {g}
                  </Link>
                ))}
            </div>
          </section>
          {catalog?.preferredGenres?.length ? (
            <p className="catalog-preference">
              По вашим жанрам:{" "}
              {catalog.preferredGenres
                .slice(0, 5)
                .map((g) => g.genre)
                .join(" · ")}{" "}
              <Link className="text-link" href="/library">
                Мои просмотры →
              </Link>
            </p>
          ) : null}
          {!!active.length && (
            <div className="catalog-active-filters">
              <span>Фильтры применены · {active.length}</span>
              <Link href={base}>Сбросить всё</Link>
            </div>
          )}
          {!catalog ? (
            <div className="catalog-empty">
              <p>
                {personalized
                  ? "Войдите в аккаунт, чтобы увидеть подборку по своим просмотрам и оценкам."
                  : "Не удалось загрузить каталог. Попробуйте обновить страницу."}
              </p>
              <Link className="outline" href={personalized ? "/account" : base}>
                {personalized ? "Войти" : "Повторить"}
              </Link>
            </div>
          ) : discovery ? (
            <div className="catalog-collections">
              {shelves.map(({ shelf, catalog: shelfCatalog }) => (
                <CatalogShelf key={shelf.key} title={shelf.title} href={"/catalog/" + shelf.key}>
                  {shelfCatalog?.items.length ? (
                    shelfCatalog.items.map((a) => <AnimeCard key={a.id} anime={a} />)
                  ) : (
                    <p className="catalog-shelf-empty">
                      {shelfCatalog
                        ? "Сейчас в этом разделе нет аниме."
                        : "Не удалось загрузить подборку."}
                    </p>
                  )}
                </CatalogShelf>
              ))}
              <Link href="/catalog/all" className="outline catalog-show-all">
                Открыть все аниме →
              </Link>
            </div>
          ) : (
            <>
              <div className="catalog-shelf-heading">
                <h2>
                  {filters.q
                    ? `Результаты: ${filters.q}`
                    : title === "Каталог"
                      ? "Все аниме"
                      : title}
                </h2>
                <span>{catalog.total.toLocaleString("ru-RU")} тайтлов</span>
              </div>
              {catalog.items.length ? (
                <div className="cards">
                  {catalog.items.map((a) => (
                    <AnimeCard key={a.id} anime={a} />
                  ))}
                </div>
              ) : (
                <div className="catalog-empty">
                  <p>
                    {filters.personalized === "1"
                      ? "Пока нет подходящих непросмотренных аниме. Посмотрите несколько серий или расширьте фильтры."
                      : "По выбранным фильтрам ничего не найдено."}
                  </p>
                  <Link href={base} className="outline">
                    Сбросить фильтры
                  </Link>
                </div>
              )}
              {catalog.pages > 1 && (
                <nav className="catalog-pagination" aria-label="Страницы каталога">
                  {catalog.page > 1 && (
                    <Link className="outline" href={pageLink(catalog.page - 1)}>
                      ← Назад
                    </Link>
                  )}
                  <span>
                    Страница {catalog.page} из {catalog.pages}
                  </span>
                  {catalog.page < catalog.pages && (
                    <Link className="outline" href={pageLink(catalog.page + 1)}>
                      Далее →
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
