import {AnimeCard} from "../components/AnimeCard";
import type {Anime, CardMeta, CommunityRatings, Progress, UserRatings} from "../lib/types";

type CatalogPageProps = {
    query: string;
    sort: string;
    groupFilter: string;
    formatFilter: string;
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
    onLoadMore: () => void;
};

/** Catalog presentation. Filtering and data loading remain owned by App. */
export function CatalogPage({
    query,
    sort,
    groupFilter,
    formatFilter,
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
    onLoadMore,
}: CatalogPageProps) {
    const resetFilters = () => {
        setYearFrom("");
        setYearTo("");
        setSort("rating-desc");
        setGenre("Все");
        setGroupFilter("all");
        setFormatFilter("all");
        setRatingSource("average");
        setRatingFrom("");
    };

    const openRandomAnime = () => {
        const picked = randomCandidates[Math.floor(Math.random() * randomCandidates.length)];
        if (picked) onOpen(picked);
    };

    return <section className="library catalog-page" id="catalog">
        <div className="section-head">
            <div><span className="eyebrow">КАТАЛОГ YUMMYANIME</span>
                <h2>{query ? `Результаты: ${query}` : "Все аниме"}</h2></div>
            <button className="outline" onClick={onHome}>← На главную</button>
        </div>
        <div className="filter-panel">
            <select value={sort} onChange={event => setSort(event.target.value)}>
                <option value="rating-desc">Рейтинг: высокий</option>
                <option value="rating-asc">Рейтинг: низкий</option>
                <option value="year-desc">Сначала новые</option>
                <option value="year-asc">Сначала старые</option>
                <option value="views">По популярности</option>
            </select>
            <select value={groupFilter} onChange={event => setGroupFilter(event.target.value)}>
                <option value="all">Франшизы и тайтлы</option>
                <option value="franchise">Только франшизы</option>
                <option value="title">Только отдельные тайтлы</option>
            </select>
            <select value={formatFilter} onChange={event => setFormatFilter(event.target.value)}>
                <option value="all">Фильмы и сериалы</option>
                <option value="series">Только сериалы</option>
                <option value="movie">Только фильмы</option>
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
            <button onClick={resetFilters}>Сбросить</button>
            <button className="random-trigger" onClick={() => setRandomOpen(!randomOpen)}>⚄ Рандом</button>
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
            className={genre === item ? "selected" : ""} onClick={() => setGenre(item)}>{item}</button>)}</div>
        {error && <div className="empty">{error}</div>}
        <div className="cards">{visible.map(anime => <AnimeCard key={anime.anime_id} anime={anime}
            meta={cardMeta[anime.anime_id]} onOpen={onOpen} favorite={favorites.includes(anime.anime_id)}
            onFavorite={() => onFavorite(anime.anime_id)} onFolders={() => onFolders(anime)}
            progress={progress[anime.anime_id]} ratings={ratings[anime.anime_id]}
            communityRating={communityRatings[anime.anime_id]}/>)}</div>
        {!query && <button type="button" className="load-more" disabled={loading} onClick={onLoadMore}>
            {loading ? "Загружаем новые аниме…" : "Показать ещё"}
        </button>}
    </section>;
}
