import type {
  Anime,
  AnimeCharacter,
  AnimeFranchise,
  FranchiseCharacter,
} from "@animesoul/contracts";
export const partTypes = {
  main: { label: "Основные сезоны", color: "#b39aff" },
  tv: { label: "TV-сериалы", color: "#84a8ff" },
  movie: { label: "Фильмы", color: "#efbf72" },
  ova: { label: "OVA", color: "#73d3b7" },
  ona: { label: "ONA", color: "#eb9fcc" },
  special: { label: "Спецвыпуски", color: "#80cadf" },
  music: { label: "Музыкальные", color: "#d4b885" },
  unknown: { label: "Другие части", color: "#a5a6b4" },
} as const;
export type PartType = keyof typeof partTypes;
export type GraphFocus =
  | { kind: "all" }
  | { kind: "point"; id: string }
  | { kind: "character"; id: string }
  | { kind: "type"; type: PartType };
export const relationLabels: Record<string, string> = {
  sequel: "Продолжение",
  prequel: "Предыстория",
  side_story: "Побочная история",
  parent_story: "Основная история",
  spin_off: "Спин-офф",
  alternative_version: "Другая версия",
  alternative_setting: "Другая вселенная",
  summary: "Пересказ",
  full_story: "Полная история",
  character: "Общие персонажи",
  other: "Связанная история",
};

export function mainStoryIds(franchise: AnimeFranchise) {
  const tv = franchise.items.filter((item) => item.anime.format === "tv");
  const selected = tv.find((item) => item.anime.id === franchise.currentAnimeId);
  const linked = franchise.edges.flatMap((edge) =>
    edge.sourceId === franchise.currentAnimeId
      ? [edge.targetId]
      : edge.targetId === franchise.currentAnimeId
        ? [edge.sourceId]
        : [],
  );
  const seed = selected ?? tv.find((item) => linked.includes(item.anime.id)) ?? tv[0];
  if (
    !seed ||
    !franchise.edges.some(
      (edge) =>
        edge.relation === "sequel" &&
        (edge.sourceId === seed.anime.id || edge.targetId === seed.anime.id),
    )
  )
    return new Set<string>();
  const ids = new Set([seed.anime.id]),
    queue = [seed.anime.id];
  for (const id of queue)
    for (const edge of franchise.edges) {
      if (edge.relation !== "sequel") continue;
      const next =
        edge.sourceId === id ? edge.targetId : edge.targetId === id ? edge.sourceId : undefined;
      if (next && !ids.has(next)) {
        ids.add(next);
        queue.push(next);
      }
    }
  return ids;
}
export function partType(anime: Anime, main: Set<string>): PartType {
  return anime.format === "tv" && main.has(anime.id) ? "main" : (anime.format ?? "unknown");
}
export function layoutFranchise(franchise: AnimeFranchise) {
  const main = mainStoryIds(franchise);
  const items = [...franchise.items].sort((a, b) => {
    const date = (anime: Anime) =>
      Date.parse(anime.details?.airedAt ?? "") ||
      (anime.year > 0 ? Date.UTC(anime.year, 0, 1) : Infinity);
    return date(a.anime) - date(b.anime) || a.anime.title.localeCompare(b.anime.title, "ru");
  });
  const laneOrder: PartType[] = [
    "main",
    "tv",
    "movie",
    "ova",
    "ona",
    "special",
    "music",
    "unknown",
  ];
  const presentTypes = new Set(items.map(({ anime }) => partType(anime, main)));
  const lanes = new Map(
    laneOrder
      .filter((type) => presentTypes.has(type))
      .map((type, index) => [type, 100 + index * 230]),
  );
  const nodes = items.map(({ anime }, index) => {
    const type = partType(anime, main);
    return { anime, type, x: 100 + index * 152, y: lanes.get(type)! };
  });
  return {
    nodes,
    width: Math.max(560, nodes.length * 152 + 160),
    height: Math.max(320, ...nodes.map((node) => node.y + 165)),
  };
}

export function franchiseCast(franchise: AnimeFranchise, animeId: string) {
  const roleOrder = { main: 0, supporting: 1, background: 2 };
  return (franchise.characters ?? [])
    .flatMap((entry) => {
      const appearance = entry.appearances.find((part) => part.animeId === animeId);
      return appearance ? [{ ...entry, role: appearance.role }] : [];
    })
    .sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        a.character.name.localeCompare(b.character.name, "ru"),
    );
}

export function mergeFranchiseCast(
  franchise: AnimeFranchise,
  animeId: string,
  cast: AnimeCharacter[],
): AnimeFranchise {
  const characters = new Map(
    (franchise.characters ?? []).map((entry) => [
      entry.character.id,
      {
        character: entry.character,
        appearances: entry.appearances.filter((appearance) => appearance.animeId !== animeId),
      },
    ]),
  );
  for (const { role, ...character } of cast) {
    const saved = characters.get(character.id);
    characters.set(character.id, {
      character,
      appearances: [...(saved?.appearances ?? []), { animeId, role }],
    });
  }
  return {
    ...franchise,
    characters: [...characters.values()].filter((entry) => entry.appearances.length > 0),
  };
}

export function franchiseFocus(
  franchise: AnimeFranchise,
  focus: GraphFocus,
  hiddenTypes: PartType[] = [],
) {
  const main = mainStoryIds(franchise);
  const visible = franchise.items.filter(
    ({ anime }) => !hiddenTypes.includes(partType(anime, main)),
  );
  const visibleIds = new Set(visible.map(({ anime }) => anime.id));
  const edges = franchise.edges.filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );
  if (focus.kind === "all") return { ids: visibleIds, edges };
  if (focus.kind === "character") {
    const character = franchise.characters?.find((entry) => entry.character.id === focus.id);
    const ids = new Set(
      (character?.appearances ?? [])
        .map((appearance) => appearance.animeId)
        .filter((id) => visibleIds.has(id)),
    );
    return { ids, edges: [] };
  }
  if (focus.kind === "point") {
    const adjacent = edges.filter(
      (edge) => edge.sourceId === focus.id || edge.targetId === focus.id,
    );
    const ids = new Set(adjacent.flatMap((edge) => [edge.sourceId, edge.targetId]));
    if (visibleIds.has(focus.id)) ids.add(focus.id);
    return { ids, edges: adjacent };
  }
  const ids = new Set(
    visible
      .filter(({ anime }) =>
        focus.type === "main" ? main.has(anime.id) : partType(anime, main) === focus.type,
      )
      .map(({ anime }) => anime.id),
  );
  return { ids, edges: edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)) };
}

export function mergeFranchiseCharacter(
  franchise: AnimeFranchise,
  character: FranchiseCharacter["character"],
  appearances: FranchiseCharacter["appearances"],
): AnimeFranchise {
  const ids = new Set(franchise.items.map((item) => item.anime.id));
  const existing = franchise.characters?.find((entry) => entry.character.id === character.id);
  const roles = new Map(
    [...(existing?.appearances ?? []), ...appearances]
      .filter((appearance) => ids.has(appearance.animeId))
      .map((appearance) => [appearance.animeId, appearance]),
  );
  if (!roles.size) return franchise;
  return {
    ...franchise,
    characters: [
      ...(franchise.characters ?? []).filter((entry) => entry.character.id !== character.id),
      { character, appearances: [...roles.values()] },
    ],
  };
}
