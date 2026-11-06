import Link from "next/link";
import type { CatalogQuery } from "@animesoul/contracts";
import { getCatalog, RateLimitedError } from "../lib/api";
import { waitLabel } from "../lib/rate-limit";
import { hasProfileSession } from "../lib/profile-viewer";
import {
  catalogFilters,
  catalogParameters,
  catalogSections,
  formatLabels,
  type CatalogSearch,
} from "../lib/catalog-filters";
import { AnimeCard } from "./AnimeCard";
import { Icon } from "./Icon";
import { CatalogShelf, RandomPicker, CatalogFilterDrawer } from "./CatalogInteractive";

const statusOptions: [string, string][] = [
  ["", "Любой"],
  ["released", "Завершённые"],
  ["ongoing", "Выходит"],
  ["announced", "Запланировано"],
];
const sourceOptions: [string, string][] = [
  ["shikimori", "Shikimori"],
  ["community", "AnimeSoul"],
  ["mine", "Моя"],
];
const groupLabels: Record<string, string> = {
  franchise: "Только франшизы",
  standalone: "Отдельные тайтлы",
};
// A removable chip's text for one applied filter.
function filterLabel(key: string, value: string | number | undefined) {
  const text = String(value ?? "");
  switch (key) {
    case "status":
      return statusOptions.find(([k]) => k === text)?.[1] ?? text;
    case "format":
      return formatLabels[text] ?? text;
    case "excludeGenre":
      return `Без: ${text}`;
    case "group":
      return groupLabels[text] ?? text;
    case "translation":
      return `Озвучка: ${text}`;
    case "ratingSource":
      return `Оценка: ${sourceOptions.find(([k]) => k === text)?.[1] ?? text}`;
    case "minRating":
      return `Рейтинг от ${Number(text).toFixed(1)}`;
    case "from":
      return `С ${text} г.`;
    case "to":
      return `До ${text} г.`;
    default:
      return text;
  }
}
// Radio buttons drawn as chips: one tap picks the value, no dropdown to open.
function ChoiceChips({
  name,
  value,
  options,
  segmented,
}: {
  name: string;
  value: string | undefined;
  options: [string, string][];
  segmented?: boolean;
}) {
  return (
    <div className={"filter-chips" + (segmented ? " is-segmented" : "")}>
      {options.map(([key, label]) => (
        <label key={key} className="filter-chip">
          <input type="radio" name={name} value={key} defaultChecked={(value ?? "") === key} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

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
  let wait: number | null = null;
  const catalog = logged
    ? await getCatalog(filters.q, { ...filters }).catch((error: unknown) => {
        if (error instanceof RateLimitedError) wait = error.retryAfter;
        return null;
      })
    : null;
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
  // Filters the section or genre route already fixes are not the reader's choice, so they get no chip.
  const fixed: Record<string, unknown> = { ...selected?.filters, ...(genre ? { genre } : {}) };
  const active = Object.entries(filters).filter(
    ([key, value]) =>
      !["q", "page", "pageSize", "sort", "personalized"].includes(key) &&
      value !== "" &&
      value !== undefined &&
      String(fixed[key] ?? "") !== String(value) &&
      (key !== "ratingSource" || value !== "shikimori"),
  );
  // Genre sits in the always-visible part; everything else is behind "Больше фильтров".
  const extraCount = active.filter(([key]) => key !== "genre").length;
  function without(key: string) {
    const next: Record<string, unknown> = { ...filters, page: undefined };
    delete next[key];
    // Defaults the parser fills in would only clutter the address.
    if (String(next.personalized) === "0") delete next.personalized;
    if (next.ratingSource === "shikimori") delete next.ratingSource;
    const query = catalogParameters(next as CatalogQuery).toString();
    return query ? base + "?" + query : base;
  }
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
            prefetch={false}
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
              <label className="filter-search">
                <Icon name="search" aria-hidden="true" />
                <input
                  type="search"
                  name="q"
                  maxLength={100}
                  aria-label="Название"
                  defaultValue={filters.q}
                  placeholder="Название аниме…"
                />
              </label>
              <label className="filter-field">
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
              <label className="filter-field">
                Жанр
                <select name="genre" defaultValue={filters.genre}>
                  <option value="">Все жанры</option>
                  {genres.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <details className="filter-more" open={extraCount > 0}>
                <summary>
                  <span className="filter-more-open">Меньше фильтров</span>
                  <span className="filter-more-closed">Больше фильтров</span>
                  {extraCount > 0 && <span className="filter-more-count">{extraCount}</span>}
                </summary>
                <div className="filter-more-body">
                  {!(selected?.filters && "status" in selected.filters) && (
                    <fieldset className="filter-group">
                      <legend>Статус</legend>
                      <ChoiceChips name="status" value={filters.status} options={statusOptions} />
                    </fieldset>
                  )}
                  {!(selected?.filters && "format" in selected.filters) && (
                    <fieldset className="filter-group">
                      <legend>Формат</legend>
                      <ChoiceChips
                        name="format"
                        value={filters.format}
                        options={[
                          ["", "Все"],
                          ...Object.entries(formatLabels).filter(([key]) => key !== "unknown"),
                        ]}
                      />
                    </fieldset>
                  )}
                  <label className="filter-field">
                    Исключить жанр
                    <select name="excludeGenre" defaultValue={filters.excludeGenre}>
                      <option value="">Не исключать</option>
                      {genres.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="filter-group">
                    <legend>Оценка</legend>
                    <ChoiceChips
                      name="ratingSource"
                      value={filters.ratingSource}
                      options={sourceOptions}
                      segmented
                    />
                    <label className="filter-field">
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
                  </fieldset>
                  <fieldset className="filter-group">
                    <legend>Годы выхода</legend>
                    <div className="catalog-year-range">
                      <input
                        type="number"
                        name="from"
                        min={1900}
                        max={2200}
                        aria-label="Год от"
                        defaultValue={filters.from}
                        placeholder="От"
                      />
                      <input
                        type="number"
                        name="to"
                        min={1900}
                        max={2200}
                        aria-label="Год до"
                        defaultValue={filters.to}
                        placeholder="До"
                      />
                    </div>
                  </fieldset>
                  <label className="filter-field">
                    Группировка
                    <select name="group" defaultValue={filters.group}>
                      <option value="">Франшизы и тайтлы</option>
                      <option value="franchise">Только франшизы</option>
                      <option value="standalone">Отдельные тайтлы</option>
                    </select>
                  </label>
                  <label className="filter-field">
                    Озвучка
                    <select name="translation" defaultValue={filters.translation}>
                      <option value="">Все озвучки</option>
                      {catalog?.translations?.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
              {filters.personalized === "1" && (
                <input type="hidden" name="personalized" value="1" />
              )}
              <div className="filter-actions">
                <button type="submit" className="primary">
                  Показать результаты
                </button>
              </div>
            </form>
          </CatalogFilterDrawer>
        </aside>
        <div className="catalog-content">
          <section
            className={"catalog-recommendations" + (discovery ? "" : " is-compact")}
            aria-label="Выбор аниме"
          >
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
                  <Link href={"/catalog/genres/" + encodeURIComponent(g)} prefetch={false} key={g}>
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
              <ul aria-label="Применённые фильтры">
                {active.map(([key, value]) => (
                  <li key={key}>
                    <Link
                      href={without(key)}
                      prefetch={false}
                      aria-label={`Убрать фильтр: ${filterLabel(key, value)}`}
                    >
                      {filterLabel(key, value)}
                      <Icon name="close" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={base} prefetch={false} className="catalog-reset">
                Сбросить всё
              </Link>
            </div>
          )}
          {!catalog ? (
            <div className="catalog-empty">
              <p>
                {personalized
                  ? "Войдите в аккаунт, чтобы увидеть подборку по своим просмотрам и оценкам."
                  : wait
                    ? `Слишком много запросов. Повторите ${waitLabel(wait)}.`
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
                      : filters.q
                        ? `По запросу «${filters.q}» ничего не найдено. Проверьте написание или сбросьте фильтры.`
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
