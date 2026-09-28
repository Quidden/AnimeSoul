import {useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {releaseStatus} from "../lib/anime";
import {recommendAnime, pickRecommendation} from "../features/catalog/recommendations";
import "../styles/catalog-discovery.css";
import {AnimeCard} from "../components/AnimeCard";
import {useModalAccessibility} from "../lib/modalAccessibility";
import {IS_ANDROID_APP} from "../lib/platform";
import type {Anime, CardMeta, CommunityRatings, Progress, UserRatings} from "../lib/types";

type CatalogPageProps = {
    ongoingLoading: boolean;
    ongoingError: string;
    ongoingHasMore: boolean;
    onLoadOngoing: () => void;
    catalog: Anime[];
    favoriteGenres: [string, number][];
    query: string;
    sort: string;
    groupFilter: string;
    formatFilter: string;
    statusFilter: string;
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
    setStatusFilter: (value: string) => void;
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
    ongoingLoading,
    ongoingError,
    ongoingHasMore,
    onLoadOngoing,
    catalog,
    favoriteGenres,
    query,
    sort,
    groupFilter,
    formatFilter,
    statusFilter,
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
    setStatusFilter,
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
    const [recommendationsOpen, setRecommendationsOpen] = useState(false);
    const [shelfLimit, setShelfLimit] = useState(12);
    const [preferredGenre, setPreferredGenre] = useState("");
    const recommendations = useMemo(() => recommendAnime(catalog, favoriteGenres, progress, preferredGenre), [catalog, favoriteGenres, progress, preferredGenre]);
    const [compact, setCompact] = useState(() => IS_ANDROID_APP || window.matchMedia("(max-width: 900px)").matches);
    const [filtersOpen, setFiltersOpen] = useState(false);
    useEffect(() => {
        const media = window.matchMedia("(max-width: 900px)");
        const update = () => { setCompact(IS_ANDROID_APP || media.matches); setFiltersOpen(false); };
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    const filterDrawerRef = useRef<HTMLDetailsElement>(null);

    const resetFilters = () => {
        setYearFrom("");
        setYearTo("");
        setSort("rating-desc");
        setGenre("Все");
        setGroupFilter("all");
        setFormatFilter("all");
        setStatusFilter("all");
        setDubbingFilter("all");
        setRatingSource("average");
        setRatingFrom("");
    };

    const openRandomAnime = () => {
        const picked = randomCandidates[Math.floor(Math.random() * randomCandidates.length)];
        if (picked) onOpen(picked);
    };

    const activeFilterCount = [
        sort !== "rating-desc",
        groupFilter !== "all",
        formatFilter !== "all",
        statusFilter !== "all",
        dubbingFilter !== "all",
        Boolean(yearFrom),
        Boolean(yearTo),
        ratingSource !== "average",
        Boolean(ratingFrom),
        genre !== "Все",
    ].filter(Boolean).length;

    const hasSearch = Boolean(query.trim());
    const discovery = !hasSearch && activeFilterCount === 0;
    const collections = [
        {key: "popular", title: "Популярное", items: [...catalog].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)),
            apply: () => { resetFilters(); setSort("views"); }},
        {key: "ongoing", title: "Онгоинги", items: catalog.filter(anime => releaseStatus(anime).kind === "airing").sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0)),
            apply: () => { resetFilters(); setStatusFilter("airing"); }},
        {key: "new", title: "Новинки", items: [...catalog].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
            apply: () => { resetFilters(); setSort("year-desc"); }},
        {key: "rated", title: "С высокой оценкой", items: catalog.filter(anime => (anime.rating?.average ?? 0) >= 8).sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0)),
            apply: () => { resetFilters(); setRatingFrom("8"); }},
    ];
    const renderCard = (anime: Anime) => <AnimeCard key={anime.anime_id} anime={anime}
        meta={cardMeta[anime.anime_id]} onOpen={onOpen} favorite={favorites.includes(anime.anime_id)}
        onVisible={onCardVisible} onFavorite={() => onFavorite(anime.anime_id)} onFolders={() => onFolders(anime)}
        progress={progress[anime.anime_id]} ratings={ratings[anime.anime_id]} communityRating={communityRatings[anime.anime_id]}/>;
    const presets = [
        {key: "popular", label: "Популярное", active: sort === "views" && statusFilter === "all" && !ratingFrom,
            apply: () => { resetFilters(); setSort("views"); }},
        {key: "new", label: "Новинки", active: sort === "year-desc" && statusFilter === "all" && !ratingFrom,
            apply: () => { resetFilters(); setSort("year-desc"); }},
        {key: "completed", label: "Завершённые", active: statusFilter === "released",
            apply: () => { resetFilters(); setStatusFilter("released"); }},
        {key: "rated", label: "С высокой оценкой", active: ratingFrom === "8" && statusFilter === "all",
            apply: () => { resetFilters(); setRatingFrom("8"); }},
    ];

    useModalAccessibility(compact && filtersOpen, () => setFiltersOpen(false), filterDrawerRef);

    return <section className="library catalog-page" id="catalog" aria-busy={loading}>
        <div className="section-head">
            <div>
                <h2>{query ? `Результаты: ${query}` : discovery ? "Каталог" : "Все аниме"}</h2>
                <p className="catalog-result-count">{loading ? "Обновляем результаты…" : `Загружено: ${visible.length}${activeFilterCount ? " · с выбранными фильтрами" : ""}`}</p></div>
            <button className="outline" onClick={onHome}>← На главную</button>
        </div>
        <div className="catalog-layout">
        <div className="catalog-controls">
        {compact && !filtersOpen && <button type="button" className="catalog-filter-fab" aria-controls="catalog-filter-panel" aria-expanded={false} onClick={() => setFiltersOpen(true)}>Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>}
        {compact && filtersOpen && <button type="button" className="catalog-filter-backdrop" aria-label="Закрыть фильтры" onClick={() => setFiltersOpen(false)} />}
        <details
            id="catalog-filter-panel"
            ref={filterDrawerRef}
            className="catalog-filter-drawer"
            open={!compact || filtersOpen}
            role={compact && filtersOpen ? "dialog" : undefined}
            aria-modal={compact && filtersOpen ? true : undefined}
            aria-label="Фильтры каталога"
            tabIndex={compact && filtersOpen ? -1 : undefined}
            onToggle={event => { if (compact) setFiltersOpen(event.currentTarget.open); }}
        >
            <summary onClick={event => { if (!compact) event.preventDefault(); }}>
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
                <option value="all">Все форматы</option>
                <option value="series">Только сериалы</option>
                <option value="movie">Только фильмы</option>
                <option value="ova">OVA</option><option value="ona">ONA</option>
                <option value="special">Спецвыпуски</option><option value="music">Клипы</option>
            </select>
            <select value={statusFilter} aria-label="Статус выхода" onChange={event => setStatusFilter(event.target.value)}>
                <option value="all">Любой статус</option><option value="airing">Выходит</option>
                <option value="released">Завершённые</option><option value="planned">Запланировано</option>
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
            <button type="button" className="filter-apply" onClick={() => setFiltersOpen(false)}>Применить</button>
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
        <div className="genre-row">{genres.map(item => <button key={item}
            aria-pressed={genre === item} className={genre === item ? "selected" : ""} onClick={() => setGenre(item)}>{item}</button>)}</div>
        </details>
        </div>
        <div className="catalog-content">
        <section className="catalog-recommendations" aria-label="Персональные рекомендации">
            <div><span className="eyebrow">ТЕСТОВЫЙ РЕЖИМ</span><h3>Что посмотреть?</h3>
                <p>{favoriteGenres.some(([, count]) => count > 0)
                    ? `По вашим жанрам: ${favoriteGenres.filter(([, count]) => count > 0).slice(0, 4).map(([name]) => name).join(", ")}.`
                    : "Посмотрите несколько серий — жанры из статистики помогут подобрать аниме."}</p>
                <small>Подбор по просмотренным жанрам. Нижняя кнопка раскрывает следующие карточки и загружает новые страницы каталога и онгоингов.</small></div>
            <label className="catalog-preferred-genre">Приоритетный жанр
                <select value={preferredGenre} onChange={event => setPreferredGenre(event.target.value)}>
                    <option value="">По всем моим жанрам</option>
                    {favoriteGenres.filter(([, count]) => count > 0).map(([name]) => <option key={name}>{name}</option>)}
                </select>
                <small>Вес жанра определяется вашими просмотрами. Выраженность жанра в самом аниме источник не указывает.</small>
            </label>
            <div className="catalog-recommendation-actions">
                <button type="button" className="primary" disabled={!recommendations.length} onClick={() => {
                    const anime = pickRecommendation(recommendations);
                    if (anime) onOpen(anime);
                }}>Случайное для меня</button>
                <button type="button" className="outline" aria-expanded={recommendationsOpen} onClick={() => setRecommendationsOpen(!recommendationsOpen)}>
                    {recommendationsOpen ? "Скрыть подборку" : "Мне может понравиться"}</button>
            </div>
            {recommendationsOpen && <div className="catalog-recommendation-results">
                {recommendations.length ? <CatalogShelf title="Вам может понравиться">{recommendations.slice(0, 20).map(({anime}) => renderCard(anime))}</CatalogShelf>
                    : <p role="status">Пока нет подходящих непросмотренных аниме. Добавьте просмотры в статистику или загрузите больше аниме.</p>}
            </div>}
        </section>
        <div className="catalog-presets" aria-label="Популярные подборки">{presets.map(preset =>
            <button key={preset.key} type="button" aria-pressed={preset.active} className={preset.active ? "is-active" : undefined}
                onClick={preset.apply}>{preset.label}</button>)}</div>
        {activeFilterCount > 0 && <div className="catalog-active-filters" role="status">
            <span>Фильтры применены · {activeFilterCount}</span><button type="button" onClick={resetFilters}>Сбросить всё</button>
        </div>}
        {error && <div className="empty catalog-feedback" role="alert">
            <span>Не удалось загрузить каталог. Проверьте подключение и повторите.</span>
            <button type="button" className="outline" onClick={onRetry}>Повторить загрузку</button>
        </div>}
        {loading && !visible.length && <div className="empty catalog-feedback" role="status" aria-live="polite">
            {hasSearch ? `Ищем «${query.trim()}»…` : "Загружаем каталог…"}
        </div>}
        {!loading && !(statusFilter === "airing" && ongoingLoading) && !error && !visible.length && <div className="empty catalog-feedback" role="status">
            {hasSearch ? `По запросу «${query.trim()}» ничего не найдено.` : "По выбранным фильтрам ничего не найдено."}
            <button type="button" className="outline" onClick={resetFilters}>Сбросить фильтры</button>
        </div>}
        {discovery ? <div className="catalog-collections">{collections.map(collection =>
            <CatalogShelf key={collection.key} title={collection.title} onViewAll={() => { collection.apply(); window.scrollTo({top: 0, behavior: "smooth"}); }}>
                {collection.items.length ? collection.items.slice(0, shelfLimit).map(renderCard)
                    : <p className="catalog-shelf-empty">{(collection.key === "ongoing" ? ongoingLoading : loading) ? "Загружаем…" : collection.key === "ongoing" && !ongoingError ? "Сейчас нет доступных онгоингов." : "В загруженной части каталога пока нет аниме."}</p>}
                {collection.key === "ongoing" && ongoingError && <div className="catalog-shelf-empty" role="alert">{ongoingError}<button type="button" onClick={onLoadOngoing}>Повторить</button></div>}
            </CatalogShelf>)}</div> : <div className="cards">{visible.map(renderCard)}</div>}
        {!discovery && statusFilter === "airing" && ongoingError && <div role="alert" className="catalog-feedback">{ongoingError}<button type="button" onClick={onLoadOngoing}>Повторить</button></div>}
        {!hasSearch && discovery && <button type="button" className="load-more" disabled={loading || ongoingLoading} onClick={() => {
            setShelfLimit(current => current + 12);
            void onLoadMore();
            if (ongoingHasMore) onLoadOngoing();
        }}>
            {loading || ongoingLoading ? "Загружаем новые аниме…" : "Показать ещё"}
        </button>}
        {!hasSearch && !discovery && (!error || visible.length > 0) && (statusFilter !== "airing" || ongoingHasMore) && <button type="button" className="load-more" disabled={loading || (statusFilter === "airing" && ongoingLoading)} onClick={onLoadMore}>
            {loading || (statusFilter === "airing" && ongoingLoading) ? "Загружаем новые аниме…" : "Показать ещё"}
        </button>}
        </div>
        </div>
    </section>;
}

function CatalogShelf({title, onViewAll, children}: {title: string; onViewAll?: () => void; children: ReactNode}) {
    const track = useRef<HTMLDivElement>(null);
    const scroll = (direction: number) => track.current?.scrollBy({left: direction * track.current.clientWidth * .85, behavior: "smooth"});
    return <section className="catalog-shelf" aria-label={title}>
        <div className="catalog-shelf-heading"><h3>{onViewAll ? <button type="button" onClick={onViewAll}>{title}</button> : title}</h3>
            <div>{onViewAll && <button type="button" onClick={onViewAll}>Смотреть все →</button>}
                <button type="button" aria-label={`${title}: листать влево`} onClick={() => scroll(-1)}>‹</button>
                <button type="button" aria-label={`${title}: листать вправо`} onClick={() => scroll(1)}>›</button></div>
        </div>
        <div ref={track} className="catalog-shelf-track" tabIndex={0} role="region" aria-label={title}>{children}</div>
    </section>;
}
