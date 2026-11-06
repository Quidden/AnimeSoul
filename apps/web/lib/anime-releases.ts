import type { Anime, AnimeFranchise } from "@animesoul/contracts";

export const releaseTimeZone = "Europe/Kyiv";
const dayMilliseconds = 86400000;

export type ReleaseDate = {
  value: string;
  timestamp: number;
  precision: "day" | "time";
};

export type AnimeRelease = {
  animeId: string;
  slug: string;
  title: string;
  label: string;
  plannedLabel: string;
  episode: number | null;
  date: ReleaseDate | null;
};

// A calendar date does not imply a midnight broadcast. Timestamps must carry a zone.
export function parseReleaseDate(value: string | undefined): ReleaseDate | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) !== day
  )
    return null;
  if (value === day) return { value, timestamp: midnight, precision: "day" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { value, timestamp, precision: "time" } : null;
}

function calendarDay(now: number) {
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone: releaseTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return Date.parse(`${value}T00:00:00Z`);
}

function upcomingDate(value: string | undefined, now: number) {
  const date = parseReleaseDate(value);
  return date &&
    (date.precision === "day" ? date.timestamp >= calendarDay(now) : date.timestamp > now)
    ? date
    : null;
}

export function animeReleases(
  anime: Anime,
  franchise: AnimeFranchise,
  now: number,
): AnimeRelease[] {
  const titles = new Map(franchise.items.map((part) => [part.anime.id, part.anime]));
  titles.set(anime.id, anime);
  return [...titles.values()]
    .flatMap((part): AnimeRelease[] => {
      if (part.status === "released") return [];
      const details = part.details;
      const next = upcomingDate(details?.nextEpisodeAt, now);
      if (
        part.status === "ongoing" &&
        !next &&
        details?.episodesTotal &&
        (details.episodesAired ?? 0) >= details.episodesTotal
      )
        return [];
      const series = part.format === "tv" || part.format === "ona";
      const premiere = part.status === "announced";
      const subject = series
        ? "нового сезона"
        : part.format === "movie"
          ? "фильма"
          : part.format === "special"
            ? "спецвыпуска"
            : "новой части";
      const plannedLabel = series
        ? "Новый сезон запланирован"
        : part.format === "movie"
          ? "Фильм запланирован"
          : part.format === "special"
            ? "Спецвыпуск запланирован"
            : "Новая часть запланирована";
      return [
        {
          animeId: part.id,
          slug: part.slug,
          title: part.title,
          label: premiere
            ? `Премьера ${subject}`
            : series
              ? "Следующая серия актуального сезона"
              : "Следующая серия",
          plannedLabel: premiere ? plannedLabel : "Новая серия запланирована",
          episode: premiere
            ? series
              ? 1
              : null
            : details?.episodesAired === undefined
              ? null
              : details.episodesAired + 1,
          date: next ?? (premiere ? upcomingDate(details?.airedAt, now) : null),
        },
      ];
    })
    .sort((a, b) => (a.date?.timestamp ?? Infinity) - (b.date?.timestamp ?? Infinity));
}

export function formatReleaseDate(date: ReleaseDate) {
  return (
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: date.precision === "time" ? releaseTimeZone : "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(date.precision === "time" ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(date.timestamp) + (date.precision === "time" ? " · Киев" : "")
  );
}

export function releaseCountdown(date: ReleaseDate, now: number) {
  if (date.precision === "day") {
    const days = Math.round((date.timestamp - calendarDay(now)) / dayMilliseconds);
    if (days === 0) return "Сегодня";
    return days > 0 ? `Через ${days} дн.` : "Ожидаем подтверждения выхода";
  }
  const seconds = Math.ceil((date.timestamp - now) / 1000);
  if (seconds <= 0) return "Ожидаем подтверждения выхода";
  const days = Math.floor(seconds / 86400);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${days} д ${pad(Math.floor((seconds % 86400) / 3600))} ч ${pad(Math.floor((seconds % 3600) / 60))} мин ${pad(seconds % 60)} с`;
}
