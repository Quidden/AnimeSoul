import { useEffect, useState } from "react";
import type { Anime, ScheduleEntry, SeasonGroup } from "../../lib/types";
import { formatCalendarDate } from "../../lib/anime";
import { animeMyAnimeListId, cachedEpisodeAirDates, fetchEpisodeAirDates, formatAirDate, type EpisodeAirDates } from "../../lib/episodeDates";

export interface ReleaseScheduleRow {
  group: SeasonGroup;
  entry: Anime;
  item: ScheduleEntry;
}

export function NextEpisodeCountdown({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((timestamp * 1000 - now) / 1000));
  if (!remaining) return <span className="next-episode-countdown">Ожидаем выход серии</span>;
  const units = [
    [Math.floor(remaining / 86400), "д."],
    [Math.floor((remaining % 86400) / 3600), "ч."],
    [Math.floor((remaining % 3600) / 60), "мин."],
    [remaining % 60, "сек."],
  ] as const;
  return <span className="next-episode-countdown" role="timer" aria-live="off" aria-label={`До выхода: ${units.map(([value, label]) => `${value} ${label}`).join(" ")}`}>
    <span className="countdown-caption">До выхода</span>
    {units.map(([value, label]) => <span className="countdown-unit" key={label}><b key={value}>{String(value).padStart(2, "0")}</b><small>{label}</small></span>)}
  </span>;
}

interface ReleaseScheduleProps {
  rows: ReleaseScheduleRow[];
  showCountdown?: boolean;
  nextRelease?: { anime: Anime; timestamp: number; episode?: number };
  entries?: Anime[];
}

/** Show announced upcoming episodes without extrapolating a weekly cadence. */
export function ReleaseSchedule({ rows, showCountdown = true, nextRelease, entries = [] }: ReleaseScheduleProps) {
  const [airDates, setAirDates] = useState<Record<number, EpisodeAirDates>>({});
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now).toISOString().slice(0, 10);
  const titles = [...new Map([...entries, ...rows.map(row => row.entry)].map(entry => [entry.anime_id, entry])).values()];
  const ids = [...new Set(titles.map(animeMyAnimeListId).filter((id): id is number => Boolean(id)))].sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    setAirDates(current => ({ ...current, ...Object.fromEntries(ids.split(",").map(Number).map(id => [id, cachedEpisodeAirDates(id)])) }));
    for (const id of ids.split(",").map(Number)) {
      void fetchEpisodeAirDates(id).then(dates => {
        if (!cancelled) setAirDates(current => ({ ...current, [id]: dates }));
      });
    }
    return () => { cancelled = true; };
  }, [ids]);
  const releases = new Map<string, { entry: Anime; label: string; episode?: number; timestamp: number; aired: boolean; dateOnly?: string }>();
  const add = (entry: Anime, label: string, episode: number | undefined, timestamp: number | undefined, aired: boolean) => {
    if (!timestamp || !Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp * 1000).getTime())) return;
    const key = `${entry.anime_id}:${episode ?? "next"}`;
    if (releases.get(key)?.aired && !aired) return;
    releases.set(key, { entry, label, episode, timestamp, aired });
  };
  for (const entry of titles) {
    const id = animeMyAnimeListId(entry);
    for (const [number, date] of Object.entries(id ? airDates[id] ?? {} : {})) {
      const episode = Number(number);
      if (!Number.isInteger(episode) || episode <= 0) continue;
      const timestamp = Date.parse(`${date}T00:00:00Z`) / 1000;
      releases.set(`${entry.anime_id}:${episode}`, { entry, label: entry.title, episode, timestamp, aired: date < today, dateOnly: date });
    }
  }
  for (const { group, entry, item } of rows) {
    const { aired, count, prev_date, next_date } = item.episodes ?? {};
    const label = group.label ?? entry.title;
    if (aired && aired > 0) add(entry, label, aired, prev_date, true);
    if (!count || aired == null || aired < count) add(entry, label, aired == null ? undefined : aired + 1, next_date, false);
  }
  if (nextRelease && ![...releases.values()].some(release => release.entry.anime_id === nextRelease.anime.anime_id && !release.aired)) {
    add(nextRelease.anime, nextRelease.anime.title, nextRelease.episode, nextRelease.timestamp, false);
  }
  const airedCounts = new Map<number, number>();
  for (const { entry, item } of rows) {
    airedCounts.set(entry.anime_id, Math.max(airedCounts.get(entry.anime_id) ?? 0, item.episodes?.aired ?? 0));
  }
  const dates = [...releases.values()]
    .filter(release => !release.aired
      && (release.episode == null || release.episode > (airedCounts.get(release.entry.anime_id) ?? 0))
      && (release.dateOnly ? release.dateOnly >= today : release.timestamp * 1000 > now))
    .sort((a, b) => a.timestamp - b.timestamp || a.entry.anime_id - b.entry.anime_id);
  if (!dates.length) return null;

  return <details className="release-schedule">
    <summary>
      <span className="eyebrow">ГРАФИК ВЫХОДА</span>
      <span className="release-schedule-count">{dates.length}</span>
    </summary>
    <p className="release-schedule-note">Предстоящие серии с известной датой выхода.</p>
    <div className="release-schedule-list">
    {dates.map(({ entry, label, episode, timestamp, aired, dateOnly }) => {
      return <article key={`${entry.anime_id}:${episode ?? "next"}:${timestamp}`}>
        <span>
          <b>{label}</b>
          <small>{episode == null ? "Следующая серия" : `Серия ${episode}`} · {aired ? "Вышла" : "Объявленный выход"}</small>
        </span>
        <div className="release-schedule-time"><time dateTime={dateOnly ?? new Date(timestamp * 1000).toISOString()}>{dateOnly ? formatAirDate(dateOnly) : formatCalendarDate(timestamp)}</time>{showCountdown && !aired && !dateOnly && timestamp > Date.now() / 1000 && <NextEpisodeCountdown timestamp={timestamp} />}</div>
      </article>;
    })}
    </div>
  </details>;
}
