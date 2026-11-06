import type { GlobalSearchResponse } from "@animesoul/contracts";

type SearchAnime = GlobalSearchResponse["anime"][number];

function episodesLabel(count: number) {
  const last = count % 10;
  const teen = count % 100;
  return teen >= 11 && teen <= 14
    ? "серий"
    : last === 1
      ? "серия"
      : last >= 2 && last <= 4
        ? "серии"
        : "серий";
}

export function searchWatchView(anime: Pick<SearchAnime, "episodes" | "watchProgress" | "status">) {
  const { total, available } = anime.episodes;
  const episodeLabel =
    total && available !== null && available < total && anime.status === "ongoing"
      ? `Вышло ${available} из ${total} серий`
      : total
        ? `${total} ${episodesLabel(total)}`
        : available
          ? `${available} ${episodesLabel(available)} вышло`
          : available === 0 && anime.status === "announced"
            ? "Серии ещё не вышли"
            : "Число серий пока неизвестно";
  const watch = anime.watchProgress;
  if (!watch) return { episodeLabel, watch: null };
  const denominator = total || available;
  const lastEpisodeLabel = watch.lastEpisode
    ? `${watch.lastEpisode.season && watch.lastEpisode.season !== "1" ? `${watch.lastEpisode.season === "0" ? "Спецвыпуски" : `Сезон ${watch.lastEpisode.season}`} · ` : ""}Серия ${watch.lastEpisode.number}${watch.lastEpisode.percent !== null ? ` · ${Math.round(watch.lastEpisode.percent)}%` : ""}`
    : "";
  const label =
    watch.status === "completed"
      ? "Просмотрено"
      : watch.status === "caught_up"
        ? "Вышедшие серии просмотрены"
        : watch.status === "not_started"
          ? "Не смотрели"
          : denominator
            ? `Просмотрено ${watch.completedEpisodes} / ${denominator}`
            : lastEpisodeLabel ||
              (watch.completedEpisodes
                ? `Просмотрено ${watch.completedEpisodes} ${episodesLabel(watch.completedEpisodes)}`
                : "Начали смотреть");
  const currentEpisodeOnly =
    watch.percent === null && watch.lastEpisode && watch.lastEpisode.percent !== null;
  const percent =
    watch.status === "not_started"
      ? 0
      : watch.status === "completed"
        ? 100
        : (watch.percent ?? watch.lastEpisode?.percent ?? null);
  return {
    episodeLabel,
    watch: {
      status: watch.status,
      label,
      percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
      detail: lastEpisodeLabel,
      progressLabel: currentEpisodeOnly ? "Прогресс текущей серии" : "Прогресс просмотра аниме",
    },
  };
}
