"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { type Anime, type AnimeFranchise, type Episode } from "@animesoul/contracts";
import { AnimePlayer } from "./AnimePlayer";
import { AnimeEpisodeList } from "./AnimeEpisodeList";
import { AnimePartSwitches } from "./AnimePartSwitches";
import { franchisePartOptions } from "../lib/franchise-navigation";
import { mainStoryIds, partType, partTypes, type PartType } from "../lib/franchise-graph";
import { franchiseMap } from "../lib/franchise-map";
import { playbackClient } from "../lib/playback-client";

type PartOption = ReturnType<typeof franchisePartOptions>[number];
type View = "list" | "map";
const accordionLimit = 8;
const gridPreview = 12;
const viewKey = "animesoul:franchise-view";

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
  const episodes = franchise.items.find((item) => item.anime.id === anime.id)?.episodes ?? [];
  const openedEpisode = initialEpisode?.animeId === anime.id ? initialEpisode : undefined;
  const [selection, setSelection] = useState({
    season:
      openedEpisode?.season ??
      (episodes.find((episode) => episode.season !== "0") ?? episodes[0])?.season ??
      "",
    episodeId: openedEpisode?.id,
  });
  const [seasonRequest, setSeasonRequest] = useState<{ season: string; revision: number }>();
  const [episodeRequest, setEpisodeRequest] = useState<{ episodeId: string; revision: number }>();
  const parts = franchisePartOptions(franchise);
  const main = mainStoryIds(franchise);
  const types = [...new Set(parts.map((part) => partType(part.anime, main)))];
  const [hiddenTypes, setHiddenTypes] = useState<PartType[]>([]);
  const [view, setView] = useState<View>("list");
  const filterKey =
    "animesoul:franchise-filters:" +
    franchise.items
      .map(({ anime }) => anime.id)
      .sort()
      .join(".");
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
      if (sessionStorage.getItem(viewKey) === "map") setView("map");
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
  function chooseView(next: View) {
    setView(next);
    try {
      sessionStorage.setItem(viewKey, next);
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
  const visibleParts = parts.filter((part) => !hiddenTypes.includes(partType(part.anime, main)));
  useEffect(() => {
    if (openedEpisode) setSelection({ season: openedEpisode.season, episodeId: openedEpisode.id });
  }, [openedEpisode?.id, openedEpisode?.season]);
  const onSelectionChange = useCallback((next: { season: string; episodeId: string }) => {
    setSelection((previous) =>
      previous.season === next.season && previous.episodeId === next.episodeId ? previous : next,
    );
  }, []);
  function preparePart(slug: string, href: string) {
    if (slug === anime.slug) return;
    router.prefetch(href);
    void playbackClient.get(slug).catch(() => {});
  }
  return (
    <section
      className="anime-watch"
      id="anime-watch"
      aria-label="Сезоны и просмотр"
      data-compass="Смотреть"
    >
      <AnimePlayer
        resumeRequested={resumeRequested}
        {...(showFilters ? { partFilters } : {})}
        slug={anime.slug}
        title={anime.title}
        previewImages={anime.details?.screenshots ?? []}
        franchise={franchise}
        allowedPartIds={visibleParts.map((part) => part.anime.id)}
        {...(openedEpisode ? { initialEpisodeId: openedEpisode.id } : {})}
        {...(initialTime === undefined ? {} : { initialTime })}
        {...(seasonRequest ? { seasonRequest } : {})}
        {...(episodeRequest ? { episodeRequest } : {})}
        onSelectionChange={onSelectionChange}
      />
      <section
        className="anime-franchise-browser"
        id="anime-episodes"
        aria-label="Сезоны и серии франшизы"
        data-compass="Серии"
      >
        {parts.length > 1 && (
          <div className="franchise-parts">
            <div className="franchise-parts-head">
              <div className="franchise-parts-title">
                <h2>Сезоны и части</h2>
                <span>{parts.length}</span>
                <div className="franchise-view" role="group" aria-label="Вид частей франшизы">
                  <button
                    type="button"
                    aria-pressed={view === "list"}
                    onClick={() => chooseView("list")}
                  >
                    Список
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === "map"}
                    onClick={() => chooseView("map")}
                  >
                    Карта
                  </button>
                </div>
              </div>
              {showFilters && <AnimePartSwitches filters={partFilters} />}
            </div>
            {!visibleParts.length ? (
              <p className="anime-episodes-empty">Включите тип частей, чтобы увидеть их.</p>
            ) : view === "map" ? (
              <FranchiseMiniMap
                franchise={franchise}
                current={anime}
                hidden={new Set(hiddenTypes)}
                hrefFor={(part) =>
                  parts.find((option) => option.anime.id === part.id)?.href ?? `/anime/${part.slug}`
                }
                onPrepare={preparePart}
              />
            ) : (
              <FranchiseParts
                parts={visibleParts}
                current={anime}
                main={main}
                onPrepare={preparePart}
              />
            )}
          </div>
        )}
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
              setEpisodeRequest(undefined);
              setSelection({ season, episodeId: undefined });
              setSeasonRequest((request) => ({ season, revision: (request?.revision ?? 0) + 1 }));
            }}
            onEpisodeChange={(episode) => {
              setSeasonRequest(undefined);
              setSelection({ season: episode.season, episodeId: episode.id });
              setEpisodeRequest((request) => ({
                episodeId: episode.id,
                revision: (request?.revision ?? 0) + 1,
              }));
            }}
          />
        </div>
      </section>
    </section>
  );
}

function typeLabel(part: PartOption, main: Set<string>) {
  return partType(part.anime, main) === "main" ? "Основной сюжет" : part.label;
}

// Up to eight parts form an accordion like the home page; larger franchises wrap as cards.
function FranchiseParts({
  parts,
  current,
  main,
  onPrepare,
}: {
  parts: PartOption[];
  current: Anime;
  main: Set<string>;
  onPrepare: (slug: string, href: string) => void;
}) {
  const selected = Math.max(
    0,
    parts.findIndex((part) => part.anime.id === current.id),
  );
  const [open, setOpen] = useState(selected);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setOpen(selected), [selected]);
  const accordion = parts.length <= accordionLimit;
  const shown = accordion || expanded ? parts : parts.slice(0, gridPreview);
  return (
    <>
      <ol
        className={accordion ? "franchise-accordion" : "franchise-grid"}
        onPointerLeave={() => setOpen(selected)}
      >
        {shown.map((part, index) => {
          const isCurrent = part.anime.id === current.id;
          const color = partTypes[partType(part.anime, main)].color;
          const count = part.anime.details?.episodesTotal;
          return (
            <li
              key={part.anime.id}
              className={accordion && index === open ? "is-open" : undefined}
              style={{ "--part-color": color } as CSSProperties}
            >
              <Link
                href={part.href}
                scroll={false}
                prefetch={false}
                aria-current={isCurrent ? "page" : undefined}
                onPointerEnter={(event) => {
                  onPrepare(part.anime.slug, part.href);
                  if (event.pointerType === "mouse") setOpen(index);
                }}
                onFocus={() => {
                  onPrepare(part.anime.slug, part.href);
                  setOpen(index);
                }}
                onTouchStart={() => onPrepare(part.anime.slug, part.href)}
              >
                {part.anime.poster ? (
                  <img src={part.anime.poster} alt="" width={160} height={240} loading="lazy" />
                ) : (
                  <span className="franchise-part-poster" />
                )}
                {isCurrent && <span className="franchise-part-now">Смотрите</span>}
                <span className="franchise-part-short" aria-hidden={accordion && index === open}>
                  <span className="franchise-part-type">{typeLabel(part, main)}</span>
                  <strong>{part.anime.title}</strong>
                </span>
                {accordion && (
                  <span className="franchise-part-info" aria-hidden={index !== open}>
                    <span className="franchise-part-type">{typeLabel(part, main)}</span>
                    <strong>{part.anime.title}</strong>
                    <small>
                      {[
                        part.anime.year || "Год уточняется",
                        part.label,
                        count ? `${count} эп.` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      {!accordion && parts.length > gridPreview && (
        <button
          className="franchise-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть" : `Показать все части · ${parts.length}`}
        </button>
      )}
    </>
  );
}

function FranchiseMiniMap({
  franchise,
  current,
  hidden,
  hrefFor,
  onPrepare,
}: {
  franchise: AnimeFranchise;
  current: Anime;
  hidden: ReadonlySet<PartType>;
  hrefFor: (anime: Anime) => string;
  onPrepare: (slug: string, href: string) => void;
}) {
  const router = useRouter();
  const map = franchiseMap(franchise, hidden);
  const open = (anime: Anime) => {
    if (anime.id !== current.id) router.push(hrefFor(anime), { scroll: false });
  };
  return (
    <div className="franchise-mini-map">
      <div className="franchise-mini-map-scroll">
        <svg
          viewBox={`0 0 ${map.width} ${map.height}`}
          width={map.width}
          height={map.height}
          role="group"
          aria-label="Карта франшизы"
        >
          {map.edges.map((edge) => {
            const vertical = edge.from.y !== edge.to.y;
            const d = vertical
              ? `M${edge.from.x},${edge.from.y} C${edge.from.x},${(edge.from.y + edge.to.y) / 2} ${edge.to.x},${(edge.from.y + edge.to.y) / 2} ${edge.to.x},${edge.to.y}`
              : `M${edge.from.x + 34},${edge.from.y} L${edge.to.x - 34},${edge.to.y}`;
            return (
              <path
                key={edge.from.anime.id + edge.to.anime.id}
                className={edge.main ? "is-main" : undefined}
                d={d}
                style={{ "--part-color": partTypes[edge.to.type].color } as CSSProperties}
              />
            );
          })}
          {map.nodes.map((node) => {
            const isCurrent = node.anime.id === current.id;
            const clip = `franchise-map-clip-${node.anime.id}`;
            const title =
              node.anime.title.length > 18 ? node.anime.title.slice(0, 17) + "…" : node.anime.title;
            return (
              <g
                key={node.anime.id}
                className={`franchise-map-node${isCurrent ? " is-current" : ""}`}
                transform={`translate(${node.x} ${node.y})`}
                style={{ "--part-color": partTypes[node.type].color } as CSSProperties}
                role="link"
                tabIndex={0}
                aria-label={`${node.anime.title}, ${node.anime.year || "год уточняется"}${isCurrent ? ", открыто сейчас" : ""}`}
                onPointerEnter={() => onPrepare(node.anime.slug, hrefFor(node.anime))}
                onClick={() => open(node.anime)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(node.anime);
                  }
                }}
              >
                <g className="franchise-map-card">
                  <text className="franchise-map-year" y={-58} textAnchor="middle">
                    {node.anime.year || "—"}
                  </text>
                  <clipPath id={clip}>
                    <rect x={-32} y={-46} width={64} height={92} rx={9} />
                  </clipPath>
                  <rect
                    className="franchise-map-fill"
                    x={-32}
                    y={-46}
                    width={64}
                    height={92}
                    rx={9}
                  />
                  {node.anime.poster && (
                    <image
                      href={node.anime.poster}
                      x={-32}
                      y={-46}
                      width={64}
                      height={92}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#${clip})`}
                    />
                  )}
                  <rect
                    className="franchise-map-ring"
                    x={-34}
                    y={-48}
                    width={68}
                    height={96}
                    rx={11}
                  />
                  <text className="franchise-map-title" y={66} textAnchor="middle">
                    {title}
                  </text>
                  <text className="franchise-map-type" y={82} textAnchor="middle">
                    {isCurrent ? "Смотрите" : partTypes[node.type].label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="franchise-map-legend">
        <span>
          <i className="is-main" />
          Продолжение
        </span>
        <span>
          <i />
          Другие связи
        </span>
        <Link href={`/anime/${current.slug}/franchise`} prefetch={false}>
          Большая карта с персонажами →
        </Link>
      </div>
    </div>
  );
}
