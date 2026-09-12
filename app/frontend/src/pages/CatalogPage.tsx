import {useRef, useState} from "react";
import {AnimeCard} from "../components/AnimeCard";
import {useModalAccessibility} from "../lib/modalAccessibility";
import {IS_ANDROID_APP} from "../lib/platform";
import type {Anime, CardMeta, CommunityRatings, Progress, UserRatings} from "../lib/types";

type CatalogPageProps = {
    query: string;
    sort: string;
    groupFilter: string;
    formatFilter: string;
    dubbingFilter: string;
    dubbings: string[];
    yearFrom: string;
    yearTo: string;
    genre: string;
    genres: string[];
    randomOpen: boolean;
    randomGenre: string;
    randomYearFrom: string;
    randomYearTo: string;
    randomRating: string;
    randomCandidates: Anime[];
    ratingSource: string;
    ratingFrom: string;
    ratingSources: {key: string; label: string}[];
    visible: Anime[];
    cardMeta: Record<number, CardMeta>;
    favorites: number[];
    progress: Progress;
    ratings: UserRatings;
    communityRatings: CommunityRatings;
    error: string;
    loading: boolean;
    setSort: (value: string) => void;
    setGroupFilter: (value: string) => void;
    setFormatFilter: (value: string) => void;
    setDubbingFilter: (value: string) => void;
    setYearFrom: (value: string) => void;
    setYearTo: (value: string) => void;
    setGenre: (value: string) => void;
    setRandomOpen: (value: boolean) => void;
    setRandomGenre: (value: string) => void;
    setRandomYearFrom: (value: string) => void;
    setRandomYearTo: (value: string) => void;
    setRandomRating: (value: string) => void;
    setRatingSource: (value: string) => void;
    setRatingFrom: (value: string) => void;
    onHome: () => void;
    onOpen: (anime: Anime) => void;
    onFavorite: (animeId: number) => void;
    onFolders: (anime: Anime) => void;
    onCardVisible: (anime: Anime) => void;
    onLoadMore: () => void;
    onRetry: () => void;
};

/** Catalog presentation. Filtering and data loading remain owned by App. */
export function CatalogPage({
    query,
    sort,
    groupFilter,
    formatFilter,
    dubbingFilter,
    dubbings,
    yearFrom,
    yearTo,
    genre,
    genres,
    randomOpen,
    randomGenre,
    randomYearFrom,
    randomYearTo,
    randomRating,
    randomCandidates,
    ratingSource,
    ratingFrom,
    ratingSources,
    visible,
    cardMeta,
    favorites,
    progress,
    ratings,
    communityRatings,
    error,
    loading,
    setSort,
    setGroupFilter,
    setFormatFilter,
    setDubbingFilter,
    setYearFrom,
    setYearTo,
    setGenre,
    setRandomOpen,
    setRandomGenre,
    setRandomYearFrom,
    setRandomYearTo,
    setRandomRating,
    setRatingSource,
    setRatingFrom,
    onHome,
    onOpen,
    onFavorite,
    onFolders,
    onCardVisible,
    onLoadMore,
    onRetry,
}: CatalogPageProps) {
    const [filtersOpen, setFiltersOpen] = useState(() => !IS_ANDROID_APP && (
        typeof window === "undefined" || !window.matchMedia("(max-width: 700px)").matches
    ));
    const filterDrawerRef = useRef<HTMLDetailsElement>(null);

    const resetFilters = () => {
        setYearFrom("");
        setYearTo("");
        setSort("rating-desc");
        setGenre("Все");
        setGroupFilter("all");
        setFormatFilter("all");
        setDubbingFilter("all");
        setRatingSource("average");
        setRatingFrom("");
        setGenre("Все");
    };

    const openRandomAnime = () => {
        const picked = randomCandidates[Math.floor(Math.random() * randomCandidates.length)];
        if (picked) onOpen(picked);
    };

    const activeFilterCount = [
        sort !== "rating-desc",
        groupFilter !== "all",
        formatFilter !== "all",
        dubbingFilter !== "all",
        Boolean(yearFrom),
        Boolean(yearTo),
        ratingSource !== "average",
        Boolean(ratingFrom),
        genre !== "Все",
    ].filter(Boolean).length;

    const hasSearch = Boolean(query.trim());

    useModalAccessibility(IS_ANDROID_APP && filtersOpen, () => setFiltersOpen(false), filterDrawerRef);

    return <section className="library catalog-page" id="catalog" aria-busy={loading}>
        <div className="section-head">
            <div><span className="eyebrow">КАТАЛОГ YUMMYANIME</span>
                <h2>{query ? `Результаты: ${query}` : "Все аниме"}</h2></div>
            <button className="outline" onClick={onHome}>← На главную</button>
        </div>
        <div className="catalog-controls">
        {filtersOpen && <button type="button" className="catalog-filter-backdrop" aria-label="Закрыть фильтры" onClick={() => setFiltersOpen(false)} />}
        <details
            ref={filterDrawerRef}
            className="catalog-filter-drawer"
            open={filtersOpen}
            role={IS_ANDROID_APP && filtersOpen ? "dialog" : undefined}
            aria-modal={IS_ANDROID_APP && filtersOpen ? true : undefined}
            aria-label={IS_ANDROID_APP && filtersOpen ? "Фильтры каталога" : undefined}
            tabIndex={IS_ANDROID_APP && filtersOpen ? -1 : undefined}
            onToggle={event => setFiltersOpen(event.currentTarget.open)}
        >
            <summary>
                <span>Фильтры каталога</span>
                <b>{activeFilterCount ? `${activeFilterCount} активн.` : "По умолчанию"}</b>
                <i aria-hidden="true">⌄</i>
            </summary>
            <div className="filter-panel">
            <select value={sort} aria-label="Сортировка каталога" onChange={event => setSort(event.target.value)}>
                <option value="rating-desc">Рейтинг: высокий</option>
                <option value="rating-asc">Рейтинг: низкий</option>
                <option value="year-desc">Сначала новые</option>
                <option value="year-asc">Сначала старые</option>
                <option value="views">По популярности</option>
            </select>
            <select value={groupFilter} aria-label="Фильтр по типу группы" onChange={event => setGroupFilter(event.target.value)}>
                <option value="all">Франшизы и тайтлы</option>
                <option value="franchise">Только франшизы</option>
                <option value="title">Только отдельные тайтлы</option>
            </select>
            <select value={formatFilter} aria-label="Фильтр по формату" onChange={event => setFormatFilter(event.target.value)}>
                <option value="all">Фильмы и сериалы</option>
                <option value="series">Только сериалы</option>
                <option value="movie">Только фильмы</option>
            </select>
            <select value={dubbingFilter} onChange={event => setDubbingFilter(event.target.value)} aria-label="Фильтр по озвучке">
                <option value="all">Все озвучки</option>
                {dubbings.filter(value => value !== "all").map(value => (
                    <option value={value} key={value}>{value}</option>
                ))}
            </select>
            <label>Оценка
                <select value={ratingSource} onChange={event => setRatingSource(event.target.value)}>
                    {ratingSources.map(source => <option value={source.key} key={source.key}>{source.label}</option>)}
                </select>
            </label>
            <label>от
                <select value={ratingFrom} onChange={event => setRatingFrom(event.target.value)}>
                    <option value="">Любая</option>
                    {[5, 6, 7, 8, 9, 10].map(value => <option value={value} key={value}>{value}.0</option>)}
                </select>
            </label>
            <label>Год от <input type="number" value={yearFrom}
                                 onChange={event => setYearFrom(event.target.value)} placeholder="1990"/></label>
            <label>до <input type="number" value={yearTo}
                             onChange={event => setYearTo(event.target.value)} placeholder="2026"/></label>
            <button type="button" className="filter-reset" disabled={!activeFilterCount} onClick={resetFilters}>Сбросить всё</button>
            <button type="button" className="random-trigger" aria-expanded={randomOpen} onClick={() => setRandomOpen(!randomOpen)}>⚄ Рандом</button>
            </div>
            {randomOpen && <div className="random-panel">
            <div>
                <label>Жанр<select value={randomGenre} onChange={event => setRandomGenre(event.target.value)}>
                    {genres.map(item => <option key={item}>{item}</option>)}
                </select></label>
                <label>Год от<input type="number" value={randomYearFrom}
                                    onChange={event => setRandomYearFrom(event.target.value)} placeholder="1990"/></label>
                <label>до<input type="number" value={randomYearTo}
                                onChange={event => setRandomYearTo(event.target.value)} placeholder="2026"/></label>
                <label>Рейтинг от<select value={randomRating}
                                        onChange={event => setRandomRating(event.target.value)}>
                    <option value="0">Любой</option>
                    <option value="6">6.0</option>
                    <option value="7">7.0</option>
                    <option value="8">8.0</option>
                    <option value="9">9.0</option>
                </select></label>
            </div>
            <button className="primary" disabled={!randomCandidates.length} onClick={openRandomAnime}>
                ⚄ Выбрать случайное аниме
            </button>
            <small>{randomCandidates.length
                ? `${randomCandidates.length} подходящих франшиз`
                : "Нет аниме с такими фильтрами"}</small>
            </div>}
        </details>
        <div className="genre-row">{genres.map(item => <button key={item}
            className={genre === item ? "selected" : ""} onClick={() => setGenre(item)}>{item}</button>)}</div>
        </div>
        {error && <div className="empty catalog-feedback" role="alert">
            <span>{error}</span>
            <button type="button" className="outline" onClick={onRetry}>Повторить загрузку</button>
        </div>}
        {loading && !visible.length && <div className="empty catalog-feedback" role="status" aria-live="polite">
            {hasSearch ? `Ищем «${query.trim()}»…` : "Загружаем каталог…"}
        </div>}
        {!loading && !error && hasSearch && !visible.length && <div className="empty catalog-feedback" role="status">
            По запросу «{query.trim()}» ничего не найдено. Попробуй другое название.
        </div>}
        <div className="cards">{visible.map(anime => <AnimeCard key={anime.anime_id} anime={anime}
            meta={cardMeta[anime.anime_id]} onOpen={onOpen} favorite={favorites.includes(anime.anime_id)}
            onVisible={onCardVisible}
            onFavorite={() => onFavorite(anime.anime_id)} onFolders={() => onFolders(anime)}
            progress={progress[anime.anime_id]} ratings={ratings[anime.anime_id]}
            communityRating={communityRatings[anime.anime_id]}/>)}</div>
        {!hasSearch && (!error || visible.length > 0) && <button type="button" className="load-more" disabled={loading} onClick={onLoadMore}>
            {loading ? "Загружаем новые аниме…" : "Показать ещё"}
        </button>}
    </section>;
}
