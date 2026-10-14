"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  animeCharactersSchema,
  characterDetailsSchema,
  type AnimeCharacter,
  type AnimeFranchise,
  type CharacterDetails,
} from "@animesoul/contracts";
import {
  franchiseFocus,
  franchiseCast,
  mergeFranchiseCast,
  mergeFranchiseCharacter,
  layoutFranchise,
  partTypes,
  relationLabels,
  type GraphFocus,
  type PartType,
} from "../lib/franchise-graph";
import { formatLabels } from "../lib/catalog-filters";
import { characterRoleLabels as characterRoles } from "../lib/characters";
import { FranchiseCharacterPanel } from "./FranchiseCharacterPanel";
import { FranchiseExternalLinks } from "./FranchiseExternalLinks";
import { useSteppedRail } from "./useSteppedRail";

type Camera = { x: number; y: number; zoom: number };
const castPageSize = 12;
function boardInset() {
  return (
    (document.querySelector(".app-header")?.getBoundingClientRect().height ?? 70) +
    (document.querySelector(".anime-navigation-island")?.getBoundingClientRect().height ?? 56)
  );
}
export function FranchiseGraph({ franchise: initialFranchise }: { franchise: AnimeFranchise }) {
  const layout = useMemo(() => layoutFranchise(initialFranchise), [initialFranchise]);
  const [seasonCasts, setSeasonCasts] = useState<Record<string, AnimeCharacter[]>>({});
  const [characterProfiles, setCharacterProfiles] = useState<Record<string, CharacterDetails>>({});
  const [characterRequest, setCharacterRequest] = useState<{
    id: string;
    status: "loading" | "error";
  } | null>(null);
  const [characterRetry, setCharacterRetry] = useState(0);
  const [castRequest, setCastRequest] = useState<{
    animeId: string;
    status: "loading" | "error";
  } | null>(null);
  const [castRetry, setCastRetry] = useState(0);
  const franchise = useMemo(
    () =>
      Object.values(characterProfiles).reduce(
        (value, character) =>
          mergeFranchiseCharacter(
            value,
            character,
            character.appearances.map(({ anime, role }) => ({ animeId: anime.id, role })),
          ),
        Object.entries(seasonCasts).reduce(
          (value, [animeId, cast]) => mergeFranchiseCast(value, animeId, cast),
          initialFranchise,
        ),
      ),
    [initialFranchise, seasonCasts, characterProfiles],
  );
  const clipId = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const seasonRail = useRef<HTMLDivElement>(null);
  const seasonRailId = `franchise-seasons-${clipId}`;
  const seasonNavigation = useSteppedRail(
    seasonRail,
    ".franchise-season-card img, .franchise-season-placeholder",
    layout.nodes.length,
  );
  const drag = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const animation = useRef(0);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [camera, setCamera] = useState(cameraRef.current);
  const [selectedId, setSelectedId] = useState(franchise.currentAnimeId);
  const [focus, setFocus] = useState<GraphFocus>({ kind: "all" });
  const [hiddenTypes, setHiddenTypes] = useState<PartType[]>([]);
  const [dragging, setDragging] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showCharacters, setShowCharacters] = useState(true);
  const [castPage, setCastPage] = useState(0);
  const selectedCharacter =
    focus.kind === "character"
      ? franchise.characters?.find((entry) => entry.character.id === focus.id)
      : undefined;
  const selectedCharacterId = selectedCharacter?.character.id;
  const selectedCharacterSlug = selectedCharacter?.character.slug;
  const selectedCharacterDetails = selectedCharacterId
    ? characterProfiles[selectedCharacterId]
    : undefined;
  const characterFailed =
    characterRequest?.id === selectedCharacterId && characterRequest?.status === "error";
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.anime.id, node])), [layout]);
  const selected = byId.get(selectedId) ?? layout.nodes[0]!;
  const castLoading = castRequest?.animeId === selectedId && castRequest.status === "loading";
  const castFailed = castRequest?.animeId === selectedId && castRequest.status === "error";
  const current = byId.get(franchise.currentAnimeId) ?? layout.nodes[0]!;
  const cast = useMemo(() => franchiseCast(franchise, selectedId), [franchise, selectedId]);
  const castPages = Math.ceil(cast.length / castPageSize);
  const characterNodes = useMemo(
    () =>
      showCharacters
        ? cast
            .slice(castPage * castPageSize, (castPage + 1) * castPageSize)
            .map((entry, index, page) => ({
              ...entry,
              x: selected.x + ((index % 6) - (Math.min(6, page.length) - 1) / 2) * 128,
              y: layout.height + 85 + Math.floor(index / 6) * 164,
            }))
        : [],
    [cast, castPage, showCharacters, selected.x, layout.height],
  );
  const initialCastSize = showCharacters
    ? Math.min(
        castPageSize,
        franchiseCast(initialFranchise, initialFranchise.currentAnimeId).length,
      )
    : 0;
  const initialCastRows = Math.ceil(initialCastSize / 6);
  const overviewHeight = layout.height + (initialCastRows ? 197 + (initialCastRows - 1) * 164 : 0);
  const overviewMinX = initialCastSize
    ? Math.min(0, current.x - (Math.min(6, initialCastSize) - 1) * 64 - 70)
    : 0;
  const overviewMaxX = initialCastSize
    ? Math.max(layout.width, current.x + (Math.min(6, initialCastSize) - 1) * 64 + 70)
    : layout.width;
  const overviewWidth = overviewMaxX - overviewMinX;
  const selectedVisible = !hiddenTypes.includes(selected.type);
  const types = [...new Set(layout.nodes.map((node) => node.type))];
  const visibleNodes = layout.nodes.filter((node) => !hiddenTypes.includes(node.type));
  const visibleIds = new Set(visibleNodes.map((node) => node.anime.id));
  const emphasized = franchiseFocus(franchise, focus, hiddenTypes);
  const emphasizedEdges = new Set(emphasized.edges);
  const selectedEdges = franchise.edges.filter(
    (edge) => edge.sourceId === selectedId || edge.targetId === selectedId,
  );
  const changeCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);
  const cancelAnimation = useCallback(() => cancelAnimationFrame(animation.current), []);
  const animateTo = useCallback(
    (target: Camera, instant = false) => {
      cancelAnimation();
      if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        changeCamera(target);
        return;
      }
      const start = cameraRef.current;
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / 480);
        const ease = 1 - Math.pow(1 - progress, 3);
        changeCamera({
          x: start.x + (target.x - start.x) * ease,
          y: start.y + (target.y - start.y) * ease,
          zoom: start.zoom + (target.zoom - start.zoom) * ease,
        });
        if (progress < 1) animation.current = requestAnimationFrame(tick);
      };
      animation.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, changeCamera],
  );
  const frameNodes = useCallback(
    (
      ids: Set<string>,
      instant = false,
      overview = false,
      targetSeasonId = selectedId,
      withDetails = detailsOpen,
    ) => {
      const nodes = layout.nodes.filter((node) => ids.has(node.anime.id));
      if (!nodes.length) return;
      const target = layout.nodes.find((node) => node.anime.id === targetSeasonId);
      const targetCast =
        showCharacters && target && ids.has(targetSeasonId)
          ? franchiseCast(franchise, targetSeasonId)
              .slice(
                targetSeasonId === selectedId ? castPage * castPageSize : 0,
                targetSeasonId === selectedId ? (castPage + 1) * castPageSize : castPageSize,
              )
              .map((_, index, page) => ({
                x: target.x + ((index % 6) - (Math.min(6, page.length) - 1) / 2) * 128,
                y: layout.height + 85 + Math.floor(index / 6) * 164,
              }))
          : [];
      const points = [...nodes, ...targetCast];
      const minX = Math.min(...points.map((node) => node.x)) - 100;
      const maxX = Math.max(...points.map((node) => node.x)) + 100;
      const minY = Math.min(...points.map((node) => node.y)) - 75;
      const maxY = Math.max(...points.map((node) => node.y)) + 145;
      // Keep the target away from pinned panels; on phones the panels fold over the board.
      const left = size.width >= 900 ? 292 : 24;
      const right = size.width >= 900 && withDetails ? 306 : 24;
      const top = boardInset() + (size.width < 900 ? 110 : 35);
      const bottom = size.width < 900 ? 234 : 220;
      const zoom = Math.max(
        size.width < 900 && !overview ? (targetCast.length ? 0.35 : 0.65) : 0.12,
        Math.min(
          1.35,
          (size.width - left - right) / (maxX - minX),
          (size.height - top - bottom) / (maxY - minY),
        ),
      );
      animateTo(
        {
          x: (minX + maxX) / 2 - (left + (size.width - left - right) / 2) / zoom,
          y: (minY + maxY) / 2 - (top + (size.height - top - bottom) / 2) / zoom,
          zoom,
        },
        instant,
      );
    },
    [layout, size, detailsOpen, animateTo, selectedId, franchise, castPage, showCharacters],
  );
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-franchise-board", "");
    if (window.matchMedia("(max-width: 899px)").matches) setLegendOpen(false);
    return () => {
      document.documentElement.removeAttribute("data-franchise-board");
      cancelAnimation();
    };
  }, [cancelAnimation]);
  useEffect(() => {
    // Reframe on viewport changes, without undoing the user's selection or pan on a filter change.
    if (size.width < 900) {
      const node =
        layout.nodes.find((part) => part.anime.id === franchise.currentAnimeId) ?? layout.nodes[0]!;
      changeCamera({
        x: node.x - size.width / 2,
        y: node.y - (size.height + boardInset() - 200) / 2 + 35,
        zoom: 1,
      });
      return;
    }
    const scale = Math.max(
      0.12,
      Math.min(
        1,
        (size.width - (size.width >= 900 ? 325 : 48)) / overviewWidth,
        (size.height - boardInset() - 230) / overviewHeight,
      ),
    );
    changeCamera({
      x:
        overviewMinX -
        (size.width / scale - overviewWidth) / 2 -
        (size.width >= 900 ? 135 / scale : 0),
      y: overviewHeight / 2 - (size.height + boardInset() - 210) / 2 / scale,
      zoom: scale,
    });
  }, [
    layout,
    size,
    franchise.currentAnimeId,
    changeCamera,
    overviewHeight,
    overviewMinX,
    overviewWidth,
  ]);
  useEffect(() => {
    seasonRail.current
      ?.querySelector(`[data-season-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  useEffect(() => {
    if (seasonCasts[selectedId] !== undefined) return;
    const controller = new AbortController();
    setCastRequest({ animeId: selectedId, status: "loading" });
    void fetch(`/api/anime/${encodeURIComponent(selected.anime.slug)}/characters`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Character cast request failed.");
        const result = animeCharactersSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setSeasonCasts((saved) => ({ ...saved, [selectedId]: result.items }));
        setCastPage((page) =>
          Math.min(page, Math.max(0, Math.ceil(result.items.length / castPageSize) - 1)),
        );
        setCastRequest(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCastRequest({ animeId: selectedId, status: "error" });
      });
    return () => controller.abort();
  }, [selectedId, selected.anime.slug, seasonCasts, castRetry]);
  useEffect(() => {
    if (!selectedCharacterId || !selectedCharacterSlug || characterProfiles[selectedCharacterId])
      return;
    const controller = new AbortController();
    setCharacterRequest({ id: selectedCharacterId, status: "loading" });
    void fetch(`/api/characters/${encodeURIComponent(selectedCharacterSlug)}`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Character profile request failed.");
        const character = characterDetailsSchema.parse(await response.json());
        if (character.id !== selectedCharacterId) throw new Error("Character identity mismatch.");
        if (controller.signal.aborted) return;
        setCharacterProfiles((profiles) => ({ ...profiles, [character.id]: character }));
        setCharacterRequest(null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCharacterRequest({ id: selectedCharacterId, status: "error" });
      });
    return () => controller.abort();
  }, [selectedCharacterId, selectedCharacterSlug, characterProfiles, characterRetry]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimation();
      const old = cameraRef.current;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      const next = Math.max(
        0.12,
        Math.min(3, old.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.0025)),
      );
      changeCamera({
        x: old.x + x / old.zoom - x / next,
        y: old.y + y / old.zoom - y / next,
        zoom: next,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [cancelAnimation, changeCamera]);
  function zoom(factor: number) {
    const old = cameraRef.current;
    const next = Math.max(0.12, Math.min(3, old.zoom * factor));
    animateTo({
      zoom: next,
      x: old.x + size.width / old.zoom / 2 - size.width / next / 2,
      y: old.y + size.height / old.zoom / 2 - size.height / next / 2,
    });
  }
  function selectType(type: PartType, targetSeasonId = selectedId) {
    const hidden = hiddenTypes.filter((value) => value !== type);
    setHiddenTypes(hidden);
    const next: GraphFocus = { kind: "type", type };
    setFocus(next);
    frameNodes(franchiseFocus(franchise, next, hidden).ids, false, false, targetSeasonId);
  }
  function selectPoint(id: string) {
    if (selectedId !== id) setCastPage(0);
    setSelectedId(id);
    setFocus({ kind: "point", id });
    setDetailsOpen(true);
  }
  function selectCharacter(id: string) {
    setFocus({ kind: "character", id });
    setDetailsOpen(false);
    const position = cast.findIndex((entry) => entry.character.id === id);
    if (position >= 0) setCastPage(Math.floor(position / castPageSize));
  }
  function travelTo(id: string) {
    const node = byId.get(id);
    if (!node) return;
    const hidden = hiddenTypes.filter((value) => value !== node.type);
    setHiddenTypes(hidden);
    selectPoint(id);
    frameNodes(
      franchiseFocus(franchise, { kind: "point", id }, hidden).ids,
      false,
      false,
      id,
      true,
    );
  }
  function toggleType(type: PartType, checked: boolean) {
    setHiddenTypes((old) => (checked ? old.filter((value) => value !== type) : [...old, type]));
    if (
      !checked &&
      ((focus.kind === "type" && focus.type === type) ||
        (focus.kind === "point" && byId.get(focus.id)?.type === type))
    )
      setFocus({ kind: "all" });
  }
  const lines = (title: string) => {
    const short =
      title.length > 58
        ? `${title.slice(0, 21).trimEnd()}… ${title.slice(-30).trimStart()}`
        : title;
    return short.match(/.{1,20}(?:\s|$)|.{1,20}/g)?.slice(0, 4) ?? [short];
  };
  const focusLabel =
    focus.kind === "type"
      ? partTypes[focus.type].label
      : focus.kind === "point"
        ? selected.anime.title
        : focus.kind === "character"
          ? (selectedCharacter?.character.name ?? "Персонаж")
          : "Все связи";
  return (
    <div className="franchise-board">
      <div ref={container} className={`franchise-graph-canvas${dragging ? " dragging" : ""}`}>
        <svg
          viewBox={`${camera.x} ${camera.y} ${size.width / camera.zoom} ${size.height / camera.zoom}`}
          role="group"
          aria-label="Граф связей франшизы"
          tabIndex={0}
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            )
              return;
            event.preventDefault();
            cancelAnimation();
            const old = cameraRef.current,
              step = 90 / old.zoom;
            changeCamera({
              ...old,
              x:
                old.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
              y: old.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
            });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as Element).closest("[data-franchise-node]"))
              return;
            cancelAnimation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const old = cameraRef.current;
            drag.current = { x: event.clientX, y: event.clientY, cameraX: old.x, cameraY: old.y };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const old = cameraRef.current;
            changeCamera({
              ...old,
              x: drag.current.cameraX - (event.clientX - drag.current.x) / old.zoom,
              y: drag.current.cameraY - (event.clientY - drag.current.y) / old.zoom,
            });
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <defs>
            <clipPath id={`${clipId}-poster`}>
              <rect x={-36} y={-54} width={72} height={108} rx={8} />
            </clipPath>
            <clipPath id={`${clipId}-portrait`}>
              <rect x={-30} y={-44} width={60} height={88} rx={20} />
            </clipPath>
            <marker
              id="franchise-direction"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {franchise.edges.map((edge) => {
            const from = byId.get(edge.sourceId),
              to = byId.get(edge.targetId);
            if (!from || !to || !visibleIds.has(from.anime.id) || !visibleIds.has(to.anime.id))
              return null;
            const dx = to.x - from.x,
              dy = to.y - from.y,
              length = Math.hypot(dx, dy) || 1;
            const offset = Math.min(
              42 / (Math.abs(dx) / length || 0.0001),
              60 / (Math.abs(dy) / length || 0.0001),
            );
            const startX = from.x + (dx / length) * offset,
              startY = from.y + (dy / length) * offset,
              endX = to.x - (dx / length) * offset,
              endY = to.y - (dy / length) * offset;
            const dimmed = focus.kind !== "all" && !emphasizedEdges.has(edge);
            return (
              <path
                key={`${edge.sourceId}:${edge.targetId}:${edge.relation}`}
                data-relation={edge.relation}
                className={`franchise-graph-edge ${edge.relation === "sequel" ? "main" : "branch"}${dimmed ? " dimmed" : focus.kind !== "all" ? " emphasized" : ""}`}
                style={{ "--part-color": partTypes[to.type].color } as CSSProperties}
                d={`M ${startX} ${startY} C ${from.x + dx / 2} ${startY}, ${to.x - dx / 2} ${endY}, ${endX} ${endY}`}
                markerEnd="url(#franchise-direction)"
              >
                <title>
                  {`${from.anime.title} → ${to.anime.title}: ${relationLabels[edge.relation] ?? "Связь Shikimori"}`}
                </title>
              </path>
            );
          })}
          {selectedVisible &&
            characterNodes.flatMap((node) =>
              node.appearances.map((appearance) => {
                const anime = byId.get(appearance.animeId);
                if (!anime || !visibleIds.has(anime.anime.id)) return null;
                return (
                  <path
                    key={`${node.character.id}:${appearance.animeId}`}
                    data-character-id={node.character.id}
                    data-anime-id={appearance.animeId}
                    className={`franchise-character-edge${focus.kind === "character" ? (node.character.id === focus.id ? " emphasized" : " dimmed") : focus.kind !== "all" && !emphasized.ids.has(appearance.animeId) ? " dimmed" : ""}`}
                    d={`M ${anime.x} ${anime.y + 60} C ${anime.x} ${anime.y + 145}, ${node.x} ${node.y - 140}, ${node.x} ${node.y - 50}`}
                  >
                    <title>{`${node.character.name} · ${characterRoles[appearance.role]} · ${anime.anime.title}`}</title>
                  </path>
                );
              }),
            )}
          {visibleNodes.map((node) => (
            <g
              key={node.anime.id}
              data-franchise-node={node.anime.id}
              data-part-type={node.type}
              className={`franchise-graph-node${node.anime.id === selectedId ? " selected" : ""}${focus.kind !== "all" && !emphasized.ids.has(node.anime.id) ? " dimmed" : ""}`}
              style={{ "--part-color": partTypes[node.type].color } as CSSProperties}
              transform={`translate(${node.x} ${node.y})`}
            >
              <title>{node.anime.title}</title>
              <rect
                className="franchise-node-halo"
                x={-43}
                y={-61}
                width={86}
                height={122}
                rx={12}
              />
              <g
                className="franchise-node-poster"
                role="button"
                tabIndex={0}
                aria-label={`Связи: ${node.anime.title}`}
                aria-pressed={focus.kind === "point" && focus.id === node.anime.id}
                onClick={() => selectPoint(node.anime.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectPoint(node.anime.id);
                  }
                }}
              >
                <rect
                  className="franchise-node-poster-frame"
                  x={-37}
                  y={-55}
                  width={74}
                  height={110}
                  rx={9}
                />
                {node.anime.poster ? (
                  <image
                    href={node.anime.poster}
                    x={-36}
                    y={-54}
                    width={72}
                    height={108}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId}-poster)`}
                  />
                ) : (
                  <text className="franchise-node-placeholder" textAnchor="middle" y={5}>
                    {formatLabels[node.anime.format ?? "unknown"]}
                  </text>
                )}
              </g>
              <text className="franchise-node-year" textAnchor="middle" y={-69}>
                {node.anime.year || "—"}
              </text>
              <text
                className="franchise-node-label"
                textAnchor="middle"
                y={75}
                role="button"
                tabIndex={0}
                aria-label={`${partTypes[node.type].label}: ${node.anime.title}`}
                aria-pressed={focus.kind === "type" && focus.type === node.type}
                onClick={() => {
                  if (selectedId !== node.anime.id) setCastPage(0);
                  setSelectedId(node.anime.id);
                  selectType(node.type, node.anime.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (selectedId !== node.anime.id) setCastPage(0);
                    setSelectedId(node.anime.id);
                    selectType(node.type, node.anime.id);
                  }
                }}
              >
                {lines(node.anime.title).map((line, index) => (
                  <tspan x={0} dy={index ? 15 : 0} key={index}>
                    {line.trim()}
                  </tspan>
                ))}
              </text>
              {node.anime.id === franchise.currentAnimeId && (
                <text textAnchor="middle" y={142} className="franchise-node-current">
                  Вы здесь
                </text>
              )}
            </g>
          ))}
          {selectedVisible &&
            characterNodes.map((node) => (
              <g
                key={node.character.id}
                data-franchise-node={`character:${node.character.id}`}
                className={`franchise-graph-character${focus.kind === "character" ? (focus.id === node.character.id ? " selected" : " dimmed") : ""}`}
                transform={`translate(${node.x} ${node.y})`}
              >
                <g
                  role="button"
                  aria-label={`Связи персонажа: ${node.character.name}`}
                  aria-pressed={focus.kind === "character" && focus.id === node.character.id}
                  tabIndex={0}
                  onClick={() => selectCharacter(node.character.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectCharacter(node.character.id);
                    }
                  }}
                >
                  <title>{`${node.character.name} · ${characterRoles[node.role]} · Выделить связи`}</title>
                  <rect
                    className="franchise-character-frame"
                    x={-31}
                    y={-45}
                    width={62}
                    height={90}
                    rx={21}
                  />
                  {node.character.image ? (
                    <image
                      href={node.character.image}
                      x={-30}
                      y={-44}
                      width={60}
                      height={88}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#${clipId}-portrait)`}
                    />
                  ) : (
                    <text className="franchise-character-initial" textAnchor="middle" y={7}>
                      {node.character.name.slice(0, 1)}
                    </text>
                  )}
                  <text className="franchise-character-name" textAnchor="middle" y={65}>
                    {lines(node.character.name)
                      .slice(0, 2)
                      .map((line, index) => (
                        <tspan key={index} x={0} dy={index ? 14 : 0}>
                          {line.trim()}
                        </tspan>
                      ))}
                  </text>
                  <text className="franchise-character-role" textAnchor="middle" y={100}>
                    {characterRoles[node.role]}
                  </text>
                </g>
              </g>
            ))}
        </svg>
        {!visibleNodes.length && (
          <p className="franchise-map-empty">
            Все типы скрыты. Включите нужные переключатели в легенде.
          </p>
        )}
        {!!visibleNodes.length && !franchise.edges.length && (
          <p className="franchise-map-empty">
            Типы связей ещё не получены. Тайтлы расположены по дате выхода.
          </p>
        )}
      </div>
      <aside
        className={`franchise-board-legend franchise-floating-panel${legendOpen || selectedCharacter ? " expanded" : ""}${selectedCharacter ? " character-selected" : ""}`}
        aria-label={selectedCharacter ? "Выбранный персонаж" : "Легенда и фильтры карты"}
      >
        {selectedCharacter ? (
          <FranchiseCharacterPanel
            entry={selectedCharacter}
            detail={selectedCharacterDetails}
            loading={!selectedCharacterDetails && !characterFailed}
            failed={characterFailed}
            parts={selectedCharacter.appearances.flatMap(({ animeId, role }) => {
              const node = byId.get(animeId);
              return node ? [{ anime: node.anime, role }] : [];
            })}
            onClose={() => setFocus({ kind: "all" })}
            onRetry={() => setCharacterRetry((value) => value + 1)}
            onSelectPart={travelTo}
          />
        ) : (
          <>
            <div className="franchise-panel-heading">
              <span>Карта франшизы · {layout.nodes.length}</span>
              <button
                className="outline"
                aria-label={legendOpen ? "Свернуть легенду" : "Развернуть легенду"}
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen(!legendOpen)}
              >
                {legendOpen ? "−" : "+"}
              </button>
            </div>
            <h1>{current.anime.title}</h1>
            <div className="franchise-legend-body" hidden={!legendOpen}>
              <p className="franchise-board-help">
                По горизонтали — порядок выхода. Перетаскивайте доску, приближайте колёсиком или
                кнопками.
              </p>
              <div
                className="franchise-graph-legend"
                role="group"
                aria-label="Типы частей франшизы"
              >
                {types.map((type) => (
                  <div
                    key={type}
                    className="franchise-type-row"
                    style={{ "--part-color": partTypes[type].color } as CSSProperties}
                  >
                    <button
                      aria-label={`Выделить: ${partTypes[type].label}`}
                      aria-pressed={focus.kind === "type" && focus.type === type}
                      onClick={() => selectType(type)}
                    >
                      <i />
                      {partTypes[type].label}
                      <small>{layout.nodes.filter((node) => node.type === type).length}</small>
                    </button>
                    <label className="anime-part-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={!hiddenTypes.includes(type)}
                        aria-label={`Показывать: ${partTypes[type].label}`}
                        onChange={(event) => toggleType(type, event.target.checked)}
                      />
                      <span className="anime-switch-slider" />
                    </label>
                  </div>
                ))}
              </div>
              <div className="franchise-relation-legend">
                <button
                  aria-label="Выделить основной сюжет"
                  onClick={() => selectType("main")}
                  disabled={!types.includes("main")}
                >
                  <i className="solid" />
                  Основной сюжет · продолжения
                </button>
                <span>
                  <i className="dashed" />
                  Ответвления · побочные истории
                </span>
                <span>
                  <i className="arrow">→</i>Направление связи Shikimori
                </span>
              </div>
              <p className="franchise-board-help">
                Постер — ближайшие связи части. Название или цвет в легенде — вся группа. Остальные
                части приглушаются.
              </p>
              <FranchiseExternalLinks links={franchise.externalLinks ?? []} />
              <div className="franchise-cast-filter" aria-busy={castLoading}>
                <div className="franchise-type-row">
                  <span>Персонажи · {cast.length}</span>
                  <label className="anime-part-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={showCharacters}
                      aria-label="Показывать персонажей выбранной части"
                      onChange={(event) => {
                        setShowCharacters(event.target.checked);
                        if (!event.target.checked && focus.kind === "character")
                          setFocus({ kind: "all" });
                      }}
                    />
                    <span className="anime-switch-slider" />
                  </label>
                </div>
                {castLoading ? (
                  <p className="franchise-cast-status" role={detailsOpen ? undefined : "status"}>
                    Загружаем персонажей этой части…
                  </p>
                ) : castFailed ? (
                  <div className="franchise-cast-error" role={detailsOpen ? undefined : "status"}>
                    <p>Не удалось загрузить персонажей.</p>
                    <button className="outline" onClick={() => setCastRetry((value) => value + 1)}>
                      Повторить
                    </button>
                  </div>
                ) : (
                  <p>
                    {cast.length
                      ? "Портреты связаны с частями, в которых появляется персонаж. Нажмите на портрет, чтобы открыть описание."
                      : "Сведения о персонажах этой части пока не добавлены."}
                  </p>
                )}
                {showCharacters && castPages > 1 && (
                  <div className="franchise-cast-pagination">
                    <button
                      className="outline"
                      aria-label="Предыдущие персонажи"
                      disabled={castPage === 0}
                      onClick={() => setCastPage((page) => page - 1)}
                    >
                      ←
                    </button>
                    <span aria-live="polite">
                      {castPage * castPageSize + 1}–
                      {Math.min((castPage + 1) * castPageSize, cast.length)} из {cast.length}
                    </span>
                    <button
                      className="outline"
                      aria-label="Следующие персонажи"
                      disabled={castPage >= castPages - 1}
                      onClick={() => setCastPage((page) => page + 1)}
                    >
                      →
                    </button>
                  </div>
                )}
              </div>
              <button
                className="outline franchise-reset"
                onClick={() => {
                  setFocus({ kind: "all" });
                  setHiddenTypes([]);
                  frameNodes(new Set(layout.nodes.map((node) => node.anime.id)), false, true);
                }}
              >
                Показать всё
              </button>
              <details className="franchise-chronology">
                <summary>Все части по дате выхода</summary>
                <ol>
                  {layout.nodes.map(({ anime, type }) => (
                    <li key={anime.id}>
                      <button onClick={() => travelTo(anime.id)}>
                        <span>
                          {anime.details?.airedAt
                            ? new Date(anime.details.airedAt).toLocaleDateString("ru-RU")
                            : anime.year || "Дата уточняется"}
                        </span>
                        {anime.title}
                        <small style={{ color: partTypes[type].color }}>
                          {partTypes[type].label}
                        </small>
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          </>
        )}
      </aside>
      {detailsOpen && (
        <aside
          className="franchise-node-details franchise-floating-panel"
          style={{ "--part-color": partTypes[selected.type].color } as CSSProperties}
          aria-label="Выбранная часть франшизы"
        >
          <div className="franchise-panel-heading">
            <span>
              {partTypes[selected.type].label} · {selected.anime.year || "—"}
            </span>
            <button
              className="outline"
              aria-label="Скрыть сведения о части"
              onClick={() => setDetailsOpen(false)}
            >
              ×
            </button>
          </div>
          {selected.anime.poster && (
            <img src={selected.anime.poster} alt="" width={120} height={180} />
          )}
          <h2>{selected.anime.title}</h2>
          <p>
            {selected.anime.details?.episodesTotal
              ? `${selected.anime.details.episodesTotal} эпизодов`
              : formatLabels[selected.anime.format ?? "unknown"]}
          </p>
          <Link className="primary" href={`/anime/${selected.anime.slug}`}>
            Открыть аниме →
          </Link>
          {!!selectedEdges.length && (
            <div className="franchise-node-relations">
              <h3>Связи Shikimori</h3>
              {selectedEdges.map((edge) => {
                const other = byId.get(
                  edge.sourceId === selectedId ? edge.targetId : edge.sourceId,
                );
                if (!other) return null;
                const label =
                  edge.relation === "sequel" && edge.targetId === selectedId
                    ? "Предыстория"
                    : edge.relation === "side_story" && edge.targetId === selectedId
                      ? "Основная история"
                      : (relationLabels[edge.relation] ?? "Связанная история");
                return (
                  <button
                    key={`${edge.sourceId}:${edge.targetId}:${edge.relation}`}
                    onClick={() => travelTo(other.anime.id)}
                  >
                    <span>{label}</span>
                    {other.anime.title}
                  </button>
                );
              })}
            </div>
          )}
          <FranchiseExternalLinks
            links={(franchise.externalLinks ?? []).filter((link) => link.sourceId === selectedId)}
            label="Другие франшизы этой части"
          />
          {(!!cast.length || castLoading || castFailed) && (
            <div className="franchise-selected-cast" aria-busy={castLoading}>
              <h3>Персонажи в этой части · {cast.length}</h3>
              {castLoading && (
                <p className="franchise-cast-status" role="status">
                  Загружаем персонажей…
                </p>
              )}
              {castFailed && (
                <div className="franchise-cast-error" role="status">
                  <p>Не удалось загрузить персонажей.</p>
                  <button className="outline" onClick={() => setCastRetry((value) => value + 1)}>
                    Повторить
                  </button>
                </div>
              )}
              {cast.map(({ character, role }) => (
                <button key={character.id} onClick={() => selectCharacter(character.id)}>
                  {character.image ? (
                    <img src={character.image} alt="" width={32} height={44} loading="lazy" />
                  ) : (
                    <span className="franchise-cast-avatar">{character.name.slice(0, 1)}</span>
                  )}
                  <span>
                    {character.name}
                    <small>{characterRoles[role]}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
      <div
        className="franchise-map-controls franchise-floating-panel"
        aria-label="Управление картой"
      >
        <button className="outline" onClick={() => zoom(1 / 1.3)} aria-label="Уменьшить карту">
          −
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button className="outline" onClick={() => zoom(1.3)} aria-label="Увеличить карту">
          +
        </button>
        <button
          className="outline"
          onClick={() => {
            setFocus({ kind: "all" });
            frameNodes(visibleIds, false, true);
          }}
        >
          Вся карта
        </button>
        <button className="outline" onClick={() => travelTo(selectedId)}>
          К выбранному
        </button>
      </div>
      <div className="franchise-focus-caption" aria-live="polite">
        {focusLabel}
        {focus.kind !== "all" ? ` · ${emphasized.ids.size} частей` : ""}
      </div>
      <section
        className="franchise-season-strip franchise-floating-panel"
        aria-label="Все части франшизы по дате выхода"
      >
        <div className="franchise-season-strip-heading">
          <h2>
            Все части франшизы <span>{layout.nodes.length}</span>
          </h2>
          <div>
            <button
              className="outline"
              aria-label="Прокрутить части назад"
              aria-controls={seasonRailId}
              disabled={!seasonNavigation.previous}
              onClick={() => seasonNavigation.move(-1)}
            >
              ←
            </button>
            <button
              className="outline"
              aria-label="Прокрутить части вперёд"
              aria-controls={seasonRailId}
              disabled={!seasonNavigation.next}
              onClick={() => seasonNavigation.move(1)}
            >
              →
            </button>
          </div>
        </div>
        <div
          id={seasonRailId}
          ref={seasonRail}
          className="franchise-season-rail"
          role="group"
          aria-label="Все части франшизы: горизонтальная лента"
          tabIndex={seasonNavigation.enabled ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              seasonNavigation.move(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          {layout.nodes.map(({ anime, type }) => (
            <article
              key={anime.id}
              data-season-id={anime.id}
              className={`franchise-season-card${anime.id === selectedId ? " selected" : ""}`}
              style={{ "--part-color": partTypes[type].color } as CSSProperties}
            >
              <Link
                href={`/anime/${anime.slug}`}
                aria-label={`Открыть аниме: ${anime.title}`}
                aria-current={anime.id === franchise.currentAnimeId ? "page" : undefined}
              >
                {anime.poster ? (
                  <img src={anime.poster} alt="" width={52} height={78} loading="lazy" />
                ) : (
                  <span className="franchise-season-placeholder">
                    {formatLabels[anime.format ?? "unknown"]}
                  </span>
                )}
                <span>
                  <strong>{anime.title}</strong>
                  <small>
                    {anime.year || "—"} · {partTypes[type].label}
                  </small>
                </span>
              </Link>
              <button
                className="outline"
                aria-label={`Найти на карте: ${anime.title}`}
                aria-pressed={anime.id === selectedId}
                onClick={() => travelTo(anime.id)}
              >
                На карте
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
