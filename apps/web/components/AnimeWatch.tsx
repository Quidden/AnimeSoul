"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { episodeHref, type Anime, type AnimeFranchise, type Episode } from "@animesoul/contracts";
import { AnimePlayer } from "./AnimePlayer";
import { AnimeEpisodeList } from "./AnimeEpisodeList";
import { AnimePartSwitches } from "./AnimePartSwitches";
import { franchisePartOptions } from "../lib/franchise-navigation";
import { mainStoryIds, partType, partTypes, type PartType } from "../lib/franchise-graph";
import type { CSSProperties } from "react";

export function AnimeWatch({
  anime,
  franchise,
  initialEpisode,
  initialTime,
  resumeRequested = false,
}: {
  anime: Anime;
  franchise: AnimeFranchise;
  initialEpisode?: Episode;
  initialTime?: number;
  resumeRequested?: boolean;
}) {
  const router = useRouter();
  const partTrack = useRef<HTMLElement>(null);
  const episodes = franchise.items.find((item) => item.anime.id === anime.id)?.episodes ?? [];
  const openedEpisode = initialEpisode?.animeId === anime.id ? initialEpisode : undefined;
  const [selection, setSelection] = useState({
    season: openedEpisode?.season ?? episodes[0]?.season ?? "",
    episodeId: openedEpisode?.id,
  });
  const [seasonRequest, setSeasonRequest] = useState<{ season: string; revision: number }>();
  const parts = franchisePartOptions(franchise);
  const main = mainStoryIds(franchise);
  const types = [...new Set(parts.map((part) => partType(part.anime, main)))];
  const [hiddenTypes, setHiddenTypes] = useState<PartType[]>([]);
  const filterKey =
    "animesoul:franchise-filters:" +
    franchise.items
      .map(({ anime }) => anime.id)
      .sort()
      .join(".");
  const [scrollParts, setScrollParts] = useState({ overflow: false, previous: false, next: false });
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(filterKey) ?? "[]");
      setHiddenTypes(
        Array.isArray(saved)
          ? saved.filter(
              (type): type is PartType =>
                typeof type === "string" && Object.hasOwn(partTypes, type),
            )
          : [],
      );
    } catch {
      /* All formats remain enabled if storage is unavailable. */
    }
  }, [filterKey]);
  function toggleType(type: PartType, visible: boolean) {
    const next = visible ? hiddenTypes.filter((value) => value !== type) : [...hiddenTypes, type];
    setHiddenTypes(next);
    try {
      sessionStorage.setItem(filterKey, JSON.stringify(next));
    } catch {
      /* Optional persistence. */
    }
  }
  const showFilters = new Set(parts.map((part) => part.anime.format ?? "unknown")).size > 1;
  const partFilters = types.map((type) => ({
    key: type,
    label: partTypes[type].label,
    color: partTypes[type].color,
    checked: !hiddenTypes.includes(type),
    onChange: (checked: boolean) => toggleType(type, checked),
  }));
  useEffect(() => {
    const track = partTrack.current;
    if (!track) return;
    const update = () =>
      setScrollParts({
        overflow:
          track.scrollHeight > track.clientHeight + 2 || track.scrollWidth > track.clientWidth + 2,
        previous: track.scrollTop > 2 || track.scrollLeft > 2,
        next:
          track.scrollTop + track.clientHeight < track.scrollHeight - 2 ||
          track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
      });
    const revealActivePart = () => {
      const active = track.querySelector('[aria-current="page"]');
      if (!active) return;
      const container = track.getBoundingClientRect(),
        item = active.getBoundingClientRect();
      track.scrollTo({
        top: track.scrollTop + item.top - container.top - (container.height - item.height) / 2,
        left: track.scrollLeft + item.left - container.left - (container.width - item.width) / 2,
      });
      update();
    };
    revealActivePart();
    const resize = new ResizeObserver(revealActivePart);
    resize.observe(track);
    track.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      track.removeEventListener("scroll", update);
    };
  }, [anime.id, hiddenTypes]);
  function scrollSeasons(direction: number) {
    const track = partTrack.current;
    if (!track) return;
    const vertical = track.scrollHeight > track.clientHeight + 2;
    track.scrollBy({
      top: vertical ? direction * track.clientHeight * 0.8 : 0,
      left: vertical ? 0 : direction * track.clientWidth * 0.8,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  useEffect(() => {
    if (openedEpisode) setSelection({ season: openedEpisode.season, episodeId: openedEpisode.id });
  }, [openedEpisode?.id, openedEpisode?.season]);
  const onSelectionChange = useCallback(
    (next: { season: string; episodeId: string }) => {
      setSelection(next);
      if (openedEpisode && next.episodeId !== openedEpisode.id)
        router.replace(episodeHref(anime.slug, next.episodeId) + "#anime-watch", {
          scroll: false,
        });
    },
    [router, anime.slug, openedEpisode?.id],
  );
  return (
    <section className="anime-watch" id="anime-watch" aria-label="Сезоны и просмотр">
      <AnimePlayer
        resumeRequested={resumeRequested}
        {...(showFilters ? { partFilters } : {})}
        slug={anime.slug}
        title={anime.title}
        previewImages={anime.details?.screenshots ?? []}
        franchise={franchise}
        allowedPartIds={parts
          .filter((part) => !hiddenTypes.includes(partType(part.anime, main)))
          .map((part) => part.anime.id)}
        {...(openedEpisode ? { initialEpisodeId: openedEpisode.id } : {})}
        {...(initialTime === undefined ? {} : { initialTime })}
        {...(seasonRequest ? { seasonRequest } : {})}
        onSelectionChange={onSelectionChange}
      />
      <section
        className="anime-franchise-browser"
        id="anime-episodes"
        aria-label="Сезоны и серии франшизы"
      >
        <div className="anime-franchise-parts anime-franchise-selector">
          <div className="catalog-shelf-heading">
            <h2>Сезоны и части</h2>
            <span>{parts.length}</span>
          </div>
          {showFilters && <AnimePartSwitches filters={partFilters} />}
          {scrollParts.overflow && (
            <div className="anime-part-scroll-controls">
              <span>Листайте все части</span>
              <button
                className="outline"
                aria-label="Предыдущие части"
                disabled={!scrollParts.previous}
                onClick={() => scrollSeasons(-1)}
              >
                ↑
              </button>
              <button
                className="outline"
                aria-label="Следующие части"
                disabled={!scrollParts.next}
                onClick={() => scrollSeasons(1)}
              >
                ↓
              </button>
            </div>
          )}
          <nav ref={partTrack} className="anime-franchise-track" aria-label="Части франшизы">
            {parts
              .filter((part) => !hiddenTypes.includes(partType(part.anime, main)))
              .map(({ anime: part, label, href }) => (
                <Link
                  key={part.id}
                  href={href}
                  className="anime-franchise-part"
                  style={{ "--part-color": partTypes[partType(part, main)].color } as CSSProperties}
                  aria-current={part.id === anime.id ? "page" : undefined}
                  scroll={false}
                  prefetch={false}
                >
                  <span className="anime-franchise-part-label">
                    {main.has(part.id) && part.format === "tv" ? "Основной сюжет · " : ""}
                    {label}
                  </span>
                  <strong className="anime-franchise-part-title">{part.title}</strong>
                  <span className="anime-franchise-part-meta">
                    {part.year || "Год уточняется"}
                    {part.details?.episodesTotal ? ` · ${part.details.episodesTotal} эп.` : ""}
                  </span>
                </Link>
              ))}
          </nav>
          {types.every((type) => hiddenTypes.includes(type)) && (
            <p className="anime-episodes-empty">Включите тип частей, чтобы увидеть их.</p>
          )}
        </div>
        <div className="anime-franchise-series">
          <AnimeEpisodeList
            slug={anime.slug}
            animeId={anime.id}
            initial={episodes}
            durationMinutes={anime.details?.duration}
            airedAt={anime.details?.airedAt}
            nextEpisodeAt={anime.details?.nextEpisodeAt}
            totalEpisodes={anime.details?.episodesTotal}
            selectedSeason={selection.season}
            {...(selection.episodeId ? { selectedEpisodeId: selection.episodeId } : {})}
            onSeasonChange={(season) => {
              setSelection({ season, episodeId: undefined });
              setSeasonRequest((request) => ({ season, revision: (request?.revision ?? 0) + 1 }));
            }}
          />
        </div>
      </section>
    </section>
  );
}
