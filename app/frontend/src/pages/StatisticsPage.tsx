import {useEffect, useMemo, useState} from "react";
import {formatDuration, formatLongDuration} from "../lib/anime";

export type StatisticsActivityEntry = {
    timestamp: number;
    animeId: number;
    title: string;
    season: number;
    episode: string;
    duration: number;
};

export type AnimeStatistics = {
    series: number;
    movies: number;
    specials: number;
    titles: number;
    totalSeconds: number;
    activity: StatisticsActivityEntry[];
    favoriteGenres: [string, number][];
    mostRewatched: { animeId: number; title: string; count: number }[];
};

type ActivityDay = {
    key: string;
    date: Date;
    entries: StatisticsActivityEntry[];
};

const localDayKey = (input: number | Date) => {
    const date = input instanceof Date ? input : new Date(input);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
};

export function StatisticsPage({statistics, onHome}: { statistics: AnimeStatistics; onHome: () => void }) {
    const maxGenre = statistics.favoriteGenres[0]?.[1] ?? 1;
    const currentYear = new Date().getFullYear();
    const availableYears = useMemo(() => {
        const eventYears = statistics.activity.map(entry => new Date(entry.timestamp).getFullYear());
        const earliest = Math.min(currentYear, ...eventYears);
        return Array.from({length: currentYear - earliest + 1}, (_, index) => currentYear - index);
    }, [statistics.activity, currentYear]);
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const yearActivity = useMemo(
        () => statistics.activity.filter(entry => new Date(entry.timestamp).getFullYear() === selectedYear),
        [statistics.activity, selectedYear],
    );
    const calendar = useMemo(() => {
        const entriesByDay = new Map<string, StatisticsActivityEntry[]>();
        for (const entry of yearActivity) {
            const key = localDayKey(entry.timestamp);
            entriesByDay.set(key, [...(entriesByDay.get(key) ?? []), entry]);
        }
        const start = new Date(selectedYear, 0, 1);
        start.setDate(start.getDate() - start.getDay());
        const end = new Date(selectedYear, 11, 31);
        end.setDate(end.getDate() + (6 - end.getDay()));
        const days: ActivityDay[] = [];
        for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
            const date = new Date(cursor), key = localDayKey(date);
            days.push({key, date, entries: entriesByDay.get(key) ?? []});
        }
        return days;
    }, [yearActivity, selectedYear]);
    const weekCount = Math.ceil(calendar.length / 7);
    const monthMarkers = useMemo(() => {
        const calendarStart = calendar[0]?.date;
        if (!calendarStart) return [];
        return Array.from({length: 12}, (_, month) => {
            const date = new Date(selectedYear, month, 1);
            const daysFromStart = Math.round((date.getTime() - calendarStart.getTime()) / 86_400_000);
            return {
                month,
                label: date.toLocaleDateString("ru-RU", {month: "short"}).replace(".", ""),
                column: Math.floor(daysFromStart / 7) + 1,
            };
        });
    }, [calendar, selectedYear]);
    const busiestDay = useMemo(
        () => calendar.reduce<ActivityDay | null>(
            (best, day) => !best || day.entries.length > best.entries.length ? day : best,
            null,
        ),
        [calendar],
    );
    const [hoveredDayKey, setHoveredDayKey] = useState("");
    useEffect(() => setHoveredDayKey(""), [selectedYear]);
    const selectedDay = calendar.find(day => day.key === hoveredDayKey)
        ?? busiestDay
        ?? calendar.at(-1);
    const activeDays = new Set(statistics.activity.map(entry => localDayKey(entry.timestamp)));
    let currentStreak = 0;
    for (const cursor = new Date(); activeDays.has(localDayKey(cursor)); cursor.setDate(cursor.getDate() - 1)) currentStreak++;
    const monthly = useMemo(() => {
        const current = new Date(), result: { key: string; label: string; count: number; seconds: number }[] = [];
        for (let index = 11; index >= 0; index--) {
            const date = new Date(current.getFullYear(), current.getMonth() - index, 1);
            result.push({
                key: `${date.getFullYear()}-${date.getMonth()}`,
                label: date.toLocaleDateString("ru-RU", {month: "short"}).replace(".", ""),
                count: 0,
                seconds: 0,
            });
        }
        const byKey = new Map(result.map(item => [item.key, item]));
        for (const entry of statistics.activity) {
            const date = new Date(entry.timestamp), item = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
            if (item) {
                item.count++;
                item.seconds += entry.duration;
            }
        }
        return result;
    }, [statistics.activity]);
    const weekdays = useMemo(() => {
        const result = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map(label => ({label, count: 0}));
        for (const entry of statistics.activity) result[new Date(entry.timestamp).getDay()].count++;
        return result;
    }, [statistics.activity]);
    const maxMonth = Math.max(1, ...monthly.map(item => item.count));
    const maxWeekday = Math.max(1, ...weekdays.map(item => item.count));
    const maxActivity = Math.max(1, ...calendar.map(day => day.entries.length));
    const activityLevel = (count: number) => count
        ? Math.min(4, Math.max(1, Math.ceil(count / maxActivity * 4)))
        : 0;
    const watchedTotal = statistics.series + statistics.movies + statistics.specials;

    return <section className="library statistics-page">
        <div className="section-head">
            <div><span className="eyebrow">ТВОЙ ПРОСМОТР</span><h2>Статистика</h2></div>
            <button className="outline" onClick={onHome}>← На главную</button>
        </div>
        <div className="stats-grid">
            <article><small>Время просмотра</small><b>{formatLongDuration(statistics.totalSeconds)}</b></article>
            <article><small>Обычных серий</small><b>{statistics.series}</b></article>
            <article><small>Фильмов</small><b>{statistics.movies}</b></article>
            <article><small>OVA / ONA / спешлов</small><b>{statistics.specials}</b></article>
            <article><small>Завершено тайтлов</small><b>{statistics.titles}</b></article>
            <article><small>Всего видео</small><b>{watchedTotal}</b></article>
            <article><small>Активных дней</small><b>{activeDays.size}</b></article>
            <article><small>Текущая серия дней</small><b>{currentStreak}</b></article>
        </div>

        <section className="statistics-panel activity-panel">
            <div className="activity-heading">
                <div><h3>Активность просмотра</h3><p>Как на GitHub: чем ярче ячейка, тем больше серий завершено в этот
                    день</p></div>
                <div className="activity-year-switcher">
                    <button type="button" aria-label="Предыдущий год"
                            disabled={!availableYears.includes(selectedYear - 1)}
                            onClick={() => setSelectedYear(year => year - 1)}>‹
                    </button>
                    <select value={selectedYear} aria-label="Год активности"
                            onChange={event => setSelectedYear(Number(event.target.value))}>
                        {availableYears.map(year => <option value={year} key={year}>{year}</option>)}
                    </select>
                    <button type="button" aria-label="Следующий год"
                            disabled={!availableYears.includes(selectedYear + 1)}
                            onClick={() => setSelectedYear(year => year + 1)}>›
                    </button>
                    <b>{yearActivity.length} завершений</b>
                </div>
            </div>
            <div className="activity-day-detail" aria-live="polite">
                <div>
                    <b>{selectedDay?.date.toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric"
                    })}</b>
                    <span>{selectedDay?.entries.length
                        ? `${selectedDay.entries.length} ${selectedDay.entries.length === 1 ? "просмотр" : "просмотра"}`
                        : "Просмотров не было"}</span>
                </div>
                <div className={`activity-day-list ${selectedDay?.entries.length ? "" : "empty"}`}>
                    {selectedDay?.entries.map((entry, index) => <article
                        key={`${entry.timestamp}:${entry.animeId}:${entry.season}:${entry.episode}:${index}`}>
                        <span><b>{entry.title}</b><small>Сезон {entry.season} · серия {entry.episode}</small></span>
                        <em>{entry.duration ? formatDuration(entry.duration) : "длительность не указана"}</em>
                    </article>)}
                    {!selectedDay?.entries.length &&
                        <span className="activity-no-entries">Выбери заполненную ячейку, чтобы увидеть серии</span>}
                </div>
            </div>
            <div className="activity-calendar-viewport">
                <div className="activity-calendar-canvas">
                    <div className="activity-months" style={{gridTemplateColumns: `repeat(${weekCount}, 12px)`}}>
                        {monthMarkers.map(month => <span key={month.month}
                                                         style={{gridColumn: month.column}}>{month.label}</span>)}
                    </div>
                    <div className="activity-calendar-body">
                        <div className="activity-weekdays"><span>Пн</span><span>Ср</span><span>Пт</span></div>
                        <div className="activity-grid" role="grid"
                             aria-label={`Календарь просмотров за ${selectedYear} год`}>
                            {calendar.map(day => <button
                                type="button"
                                role="gridcell"
                                key={day.key}
                                className={`activity-cell level-${activityLevel(day.entries.length)}${selectedDay?.key === day.key ? " selected" : ""}${day.date.getFullYear() !== selectedYear ? " outside-year" : ""}`}
                                aria-label={`${day.date.toLocaleDateString("ru-RU")}: ${day.entries.length} просмотров`}
                                title={`${day.date.toLocaleDateString("ru-RU")}: ${day.entries.length} просмотров`}
                                onMouseEnter={() => setHoveredDayKey(day.key)}
                                onFocus={() => setHoveredDayKey(day.key)}
                            />)}
                        </div>
                    </div>
                </div>
            </div>
            <div className="activity-legend"><span>Меньше</span>{[0, 1, 2, 3, 4].map(level => <i
                className={`level-${level}`} key={level}/>)}<span>Больше</span></div>
        </section>

        <div className="statistics-trends">
            <section className="statistics-panel">
                <h3>Последние 12 месяцев</h3>
                <p>Количество завершённых серий, фильмов и спецвыпусков</p>
                <div className="month-chart">{monthly.map(item => <div key={item.key}
                                                                       title={`${item.count} просмотров · ${formatLongDuration(item.seconds)}`}>
                    <span><i style={{height: `${item.count / maxMonth * 100}%`}}/></span>
                    <small>{item.label}</small>
                </div>)}</div>
            </section>
            <section className="statistics-panel">
                <h3>По дням недели</h3>
                <p>Когда ты чаще всего заканчиваешь просмотр</p>
                <div className="weekday-chart">{weekdays.map(item => <div key={item.label}>
                    <span>{item.label}<b>{item.count}</b></span>
                    <i><em style={{width: `${item.count / maxWeekday * 100}%`}}/></i>
                </div>)}</div>
            </section>
        </div>

        <div className="statistics-columns">
            <section className="statistics-panel">
                <h3>Любимые жанры</h3><p>По количеству просмотренных серий и фильмов</p>
                <div className="genre-stats">{statistics.favoriteGenres.map(([genre, count]) => <div key={genre}>
                    <span>{genre}<b>{count}</b></span><i><em style={{width: `${count / maxGenre * 100}%`}}/></i>
                </div>)}{!statistics.favoriteGenres.length &&
                    <div className="stats-empty">Здесь появятся жанры после просмотра серий.</div>}</div>
            </section>
            <section className="statistics-panel">
                <h3>Чаще всего пересматриваешь</h3><p>Повторные завершения одной и той же серии</p>
                <div className="rewatch-list">{statistics.mostRewatched.map((item, index) => <article
                    key={item.animeId}><b>{index + 1}</b><span>{item.title}</span><em>{item.count}×</em>
                </article>)}{!statistics.mostRewatched.length &&
                    <div className="stats-empty">Пересмотры начнут учитываться после этого обновления.</div>}</div>
            </section>
        </div>
    </section>;
}
