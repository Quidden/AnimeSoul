import type { Anime, AnimeUserRatings, CommunityAnimeRating } from "../lib/types";
import { animeApiRatings, animeSeasonsAverage, formatRating } from "../lib/ratings";

export function RatingBoard({
  anime,
  ratings,
  communityRating,
  compact = false,
  apiOnly = false,
  className = "",
}: {
  anime: Anime;
  ratings?: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  compact?: boolean;
  apiOnly?: boolean;
  className?: string;
}) {
  const calculated = animeSeasonsAverage(ratings);
  const items = [
    ...(!apiOnly && ratings?.anime !== undefined
      ? [{ key: "user", label: "Моя", value: ratings.anime, kind: "user" }]
      : []),
    ...(!apiOnly && calculated !== undefined
      ? [{ key: "calculated", label: "Средняя", value: calculated, kind: "calculated" }]
      : []),
    ...(communityRating?.anime
      ? [{
          key: "animesoul",
          label: "AnimeSoul",
          value: communityRating.anime.average,
          count: communityRating.anime.count,
          kind: "community",
        }]
      : []),
    ...animeApiRatings(anime).map(source => ({
      key: source.key,
      label: compact ? source.shortLabel : source.label,
      value: source.value,
      count: undefined,
      kind: "api",
    })),
  ];

  if (!items.length) return null;
  return (
    <div className={`rating-board ${compact ? "compact " : ""}${className}`.trim()}>
      {items.map(item => (
        <span className={`rating-chip ${item.kind}`} key={item.key} title={`${item.label}: ${formatRating(item.value)}${item.count ? ` · ${item.count} оценок` : ""}`}>
          <small>{item.label}</small>
          <b>{formatRating(item.value)}</b>
        </span>
      ))}
    </div>
  );
}
