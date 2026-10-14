import { animeDetailsSchema, publicMediaUrl } from "@animesoul/contracts";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const number = (v: unknown, max = 2147483647) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0 &&
  Number(v) <= max
    ? Number(v)
    : undefined;
const strings = (v: unknown) =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .map((x) =>
              typeof x === "string"
                ? x.trim().slice(0, 200)
                : String(object(x).name ?? object(x).title ?? ""),
            )
            .filter(Boolean),
        ),
      ].slice(0, 30)
    : [];
const date = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) ? v.slice(0, 40) : undefined;
const integer = (value: unknown, max: number) => {
  const parsed = number(value, max);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
};
export function catalogMetadata(raw: unknown, source: "kodik" | "yummy") {
  const row = object(raw),
    data = source === "kodik" ? object(row.material_data) : row;
  const ratings = object(data.rating);
  const score = number(source === "kodik" ? data.shikimori_rating : ratings.shikimori_rating, 10);
  const votes = number(data.shikimori_votes);
  const kind = String(data.anime_kind ?? object(data.type).alias ?? "").toLowerCase();
  const format =
    (
      {
        tv: "tv",
        series: "tv",
        movie: "movie",
        ova: "ova",
        ona: "ona",
        special: "special",
        tv_special: "special",
        music: "music",
      } as Record<string, string>
    )[kind] ??
    (source === "kodik"
      ? row.type === "anime-serial"
        ? "tv"
        : row.type === "anime"
          ? "movie"
          : undefined
      : undefined);
  const studios = strings(data.anime_studios ?? data.studios);
  const screenshots = Array.isArray(data.screenshots)
    ? data.screenshots
        .filter((v): v is string => typeof v === "string" && publicMediaUrl(v))
        .slice(0, 20)
    : [];
  const details = animeDetailsSchema.parse({
    duration: integer(data.duration, 10000),
    episodesTotal: integer(data.episodes_total ?? object(data.episodes).count, 100000),
    episodesAired: integer(data.episodes_aired, 100000),
    airedAt: date(data.aired_at),
    releasedAt: date(data.released_at),
    nextEpisodeAt: date(object(data.episodes).next_date),
    ...(studios.length ? { studios } : {}),
    ...(screenshots.length ? { screenshots } : {}),
    ...(data.minimal_age !== undefined
      ? { ageRating: `${data.minimal_age}+` }
      : object(data.min_age).title
        ? { ageRating: String(object(data.min_age).title).slice(0, 100) }
        : {}),
  });
  const translations =
    source === "kodik" ? strings([object(row.translation).title]) : strings(data.translates);
  return {
    ...(details.airedAt &&
    Number(details.airedAt.slice(0, 4)) >= 1900 &&
    Number(details.airedAt.slice(0, 4)) <= 2200
      ? { year: Number(details.airedAt.slice(0, 4)) }
      : {}),
    ...(score && score > 0 ? { shikimoriScore: score } : {}),
    ...(votes !== undefined ? { shikimoriVotes: Math.trunc(votes) } : {}),
    ...(votes !== undefined || number(data.views) !== undefined
      ? { popularity: Math.trunc(votes ?? number(data.views) ?? 0) }
      : {}),
    ...(format ? { format } : {}),
    ...(translations.length ? { translations } : {}),
    ...(Object.values(details).some((v) => v !== undefined) ? { details } : {}),
  };
}
