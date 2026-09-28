import { animeCatalogFilters } from "../../lib/catalogFilters";
import { CatalogLink } from "./CatalogLink";
import type { Anime } from "../../lib/types";
import type { AnimeMetadata } from "./useAnimeMetadata";
import { ReleaseSchedule, type ReleaseScheduleRow } from "./ReleaseSchedule";

export function AnimeFacts({ anime, metadata, rows, showCountdown = true, entries }: { anime: Anime; metadata?: AnimeMetadata; rows: ReleaseScheduleRow[]; showCountdown?: boolean; entries?: Anime[] }) {
  const filters = animeCatalogFilters(anime, metadata);
  const date = (value?: string) => value ? new Date(value).toLocaleDateString("ru-RU") : undefined;
  const next = metadata?.next_episode_at ? Date.parse(metadata.next_episode_at) / 1000 : 0;
  const status = ({ released: "Вышло", anons: "Запланировано", ongoing: "Выходит" } as Record<string, string>)[metadata?.status ?? anime.anime_status?.alias ?? ""] ?? anime.anime_status?.title ?? "Статус неизвестен";
  const facts = [
    ["Тип", ({ tv: "TV-сериал", movie: "Фильм", ova: "OVA", ona: "ONA", special: "Спецвыпуск", tv_special: "ТВ-спецвыпуск", music: "Клип" } as Record<string, string>)[metadata?.kind ?? ""] ?? anime.type?.name],
    ["Статус", status],
    ["Эпизоды", metadata?.episodes ? `${metadata.episodes_aired ?? 0} / ${metadata.episodes}` : metadata?.episodes_aired ? `${metadata.episodes_aired} вышло` : undefined],
    ["Длительность", metadata?.duration ? `${metadata.duration} мин.` : undefined],
    ["Премьера", date(metadata?.aired_on) ?? anime.year],
    ["Завершение", date(metadata?.released_on)],
    ["Студия", metadata?.studios?.map(studio => studio.name).join(", ")],
    ["Возрастной рейтинг", metadata?.rating?.replaceAll("_", " ").toUpperCase()],
  ];
  const visibleFacts = facts.filter(([, value]) => value);
  const links: Record<string, Record<string, string>> = {
    Тип: { format: filters.format },
    Статус: { status: filters.status },
    ...(filters.year ? { Премьера: { yearFrom: filters.year, yearTo: filters.year } } : {}),
  };
  return <section className="anime-information" aria-label="Информация об аниме">
    <h2>Информация</h2>
    <dl className={`anime-facts${visibleFacts.length <= 3 ? " anime-facts-inline" : ""}`}>{visibleFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label && links[label] ? <CatalogLink filters={links[label]}>{value}</CatalogLink> : value}</dd></div>)}</dl>
    <ReleaseSchedule rows={rows} entries={entries ?? [anime]} showCountdown={showCountdown} nextRelease={next > 0 ? { anime, timestamp: next, episode: metadata?.episodes_aired == null ? undefined : metadata.episodes_aired + 1 } : undefined} />
  </section>;
}
