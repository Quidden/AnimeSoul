import { ServiceUnavailableException } from "@nestjs/common";
import {
  episodeSchema,
  animeDetailsSchema,
  franchiseLimits,
  franchiseSchema,
  type Anime,
  type AnimeFranchise,
} from "@animesoul/contracts";
import type { Database } from "@animesoul/database";
import { developmentAnime, developmentCharacters } from "@animesoul/database/fixtures";
import type { Configuration } from "../config.js";
import { enrichAnime } from "./discovery.js";
import { refreshShikimoriFranchise } from "./shikimori-franchise.js";
import { franchiseCharacters, invalidateCharacterIndex } from "./characters.js";
import { refreshAnimeCharacters } from "./shikimori-characters.js";

export const franchiseGraphLimit = 50000;
export type FranchiseGraphRow = {
  id: string;
  published: boolean;
  isDevelopment: boolean;
  metadataProvider: string;
  details: unknown;
  providers: { provider: string; externalId: string }[];
};

function identities(row: FranchiseGraphRow) {
  return row.providers.flatMap((reference) => {
    if (reference.provider === "shikimori" && /^\d{1,15}$/.test(reference.externalId))
      return ["shikimori:" + reference.externalId];
    if (
      reference.provider === "kodik-material" &&
      /^shikimori:\d{1,15}$/.test(reference.externalId)
    )
      return [reference.externalId];
    return [];
  });
}
function details(row: FranchiseGraphRow, key: string) {
  const value = row.details;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string").slice(0, 100)
    : [];
}

// Provider identities reconcile old UUID references before building undirected
// edges. Titles and guessed season numbers never establish a relationship.
export function resolveFranchise(
  rows: FranchiseGraphRow[],
  currentAnimeId: string,
  production = false,
) {
  if (rows.length > franchiseGraphLimit)
    throw new ServiceUnavailableException("Franchise graph exceeds its supported catalog size.");
  const available = rows.filter((row) => row.published && (!production || !row.isDevelopment));
  const parents = new Map(available.map((row) => [row.id, row.id]));
  const owner = new Map<string, string>();
  const root = (id: string): string => {
    let current = id;
    const visited: string[] = [];
    while (parents.get(current) !== current) {
      visited.push(current);
      current = parents.get(current)!;
    }
    for (const entry of visited) parents.set(entry, current);
    return current;
  };
  for (const row of available) {
    for (const identity of identities(row)) {
      const existing = owner.get(identity);
      if (existing) parents.set(root(row.id), root(existing));
      else owner.set(identity, row.id);
    }
  }
  const grouped = new Map<string, FranchiseGraphRow[]>();
  for (const row of available) {
    const key = root(row.id);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const canonical = new Map<string, string>();
  for (const group of grouped.values()) {
    const preferred = group
      .filter((row) => row.metadataProvider !== "legacy")
      .sort((a, b) => {
        const primary = (row: FranchiseGraphRow) =>
          row.providers.some((reference) => reference.provider === "kodik-material") ? 0 : 1;
        return primary(a) - primary(b) || a.id.localeCompare(b.id);
      })[0];
    if (preferred) for (const row of group) canonical.set(row.id, preferred.id);
  }
  const current = canonical.get(currentAnimeId);
  if (!current) return null;
  const visibleIds = new Set(canonical.values());
  const blockedIdentities = new Set(rows.flatMap(identities));
  for (const row of available)
    for (const identity of identities(row)) blockedIdentities.delete(identity);
  const providerNode = (externalId: string) => {
    const identity = "shikimori:" + externalId;
    if (blockedIdentities.has(identity)) return undefined;
    const mapped = owner.get(identity);
    // A provider graph can pass through a special that has no current catalog
    // record. Keep that identity for traversal without exposing a legacy title.
    return (mapped ? canonical.get(mapped) : undefined) ?? identity;
  };
  const edges = new Map<string, Set<string>>();
  type Edge = { sourceId: string; targetId: string; relation: string };
  const typed = new Map<string, Edge>();
  const untyped = new Map<string, { sourceId: string; targetId: string }>();
  const described = new Set<string>();
  const storyRelations = new Set([
    "sequel",
    "side_story",
    "spin_off",
    "summary",
    "full_story",
    "alternative_version",
    "alternative_setting",
  ]);
  const pair = (a: string, b: string) => [a, b].sort().join(":");
  const typedPairs = new Set<string>();
  const storyPairs = new Set<string>();
  for (const id of visibleIds) edges.set(id, new Set());
  const ensureNode = (id: string) => {
    if (!edges.has(id)) edges.set(id, new Set());
    if (edges.size > franchiseGraphLimit)
      throw new ServiceUnavailableException("Franchise graph exceeds its supported catalog size.");
  };
  const connect = (source: string, candidate: string) => {
    ensureNode(source);
    ensureNode(candidate);
    edges.get(source)!.add(candidate);
    edges.get(candidate)!.add(source);
  };
  for (const row of available) {
    const source = canonical.get(row.id);
    const remember = (target: string | undefined) => {
      if (source && target && target !== source)
        untyped.set(pair(source, target), { sourceId: source, targetId: target });
    };
    for (const id of details(row, "relatedAnimeIds")) remember(canonical.get(id));
    for (const id of details(row, "relatedExternalIds")) {
      if (!/^\d{1,15}$/.test(id)) continue;
      const mapped = owner.get("shikimori:" + id);
      remember(mapped ? canonical.get(mapped) : undefined);
    }
    const parsed = animeDetailsSchema.safeParse(row.details);
    if (!parsed.success) continue;
    // Complete provider graphs supersede legacy untyped links, including reverse
    // links from crossovers that otherwise join independent franchises.
    if (source && parsed.data.franchiseRelations) described.add(source);
    for (const edge of [
      ...(parsed.data.franchiseRelations ?? []),
      ...(parsed.data.relatedRelations ?? []),
    ]) {
      let sourceId = providerNode(edge.sourceId),
        targetId = providerNode(edge.targetId);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      if (parsed.data.franchiseRelations?.includes(edge)) {
        described.add(sourceId);
        described.add(targetId);
      }
      let relation = edge.relation;
      if (relation === "prequel") {
        [sourceId, targetId] = [targetId, sourceId];
        relation = "sequel";
      }
      if (relation === "parent_story") {
        [sourceId, targetId] = [targetId, sourceId];
        relation = "side_story";
      }
      const symmetric = [
        "alternative_version",
        "alternative_setting",
        "character",
        "other",
      ].includes(relation);
      if (symmetric && sourceId > targetId) [sourceId, targetId] = [targetId, sourceId];
      const key = pair(sourceId, targetId);
      typedPairs.add(key);
      if (storyRelations.has(relation)) {
        connect(sourceId, targetId);
        storyPairs.add(key);
      }
      typed.set(`${sourceId}:${targetId}:${relation}`, { sourceId, targetId, relation });
    }
  }
  for (const [key, { sourceId, targetId }] of untyped) {
    if (!typedPairs.has(key) && !described.has(sourceId) && !described.has(targetId))
      connect(sourceId, targetId);
  }
  const selected = new Set([current]);
  const selectedIds = new Set([current]);
  const queue = [current];
  for (let index = 0; index < queue.length; index++) {
    for (const id of edges.get(queue[index]!)!) {
      if (selected.has(id)) continue;
      selected.add(id);
      if (visibleIds.has(id)) selectedIds.add(id);
      if (selectedIds.size > franchiseLimits.items)
        throw new ServiceUnavailableException("Franchise exceeds its supported number of parts.");
      queue.push(id);
    }
  }
  const projected = new Map<string, Edge>();
  const project = (edge: Edge) => {
    projected.set(`${edge.sourceId}:${edge.targetId}:${edge.relation}`, edge);
    if (projected.size > franchiseLimits.edges)
      throw new ServiceUnavailableException("Franchise exceeds its supported number of links.");
  };
  const sequels = new Map<string, Set<string>>();
  for (const edge of typed.values()) {
    if (
      storyRelations.has(edge.relation) &&
      selectedIds.has(edge.sourceId) &&
      selectedIds.has(edge.targetId)
    )
      project(edge);
    if (edge.relation !== "sequel") continue;
    const targets = sequels.get(edge.sourceId) ?? new Set<string>();
    targets.add(edge.targetId);
    sequels.set(edge.sourceId, targets);
  }
  // Contract only directed sequel paths through unavailable provider records.
  // Stop at each visible part so we keep chronology without adding shortcuts
  // across visible seasons or guessing relations for mixed story paths.
  for (const sourceId of selectedIds) {
    const visited = new Set([sourceId]);
    const next = [...(sequels.get(sourceId) ?? [])];
    for (let index = 0; index < next.length; index++) {
      const targetId = next[index]!;
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      if (selectedIds.has(targetId))
        project({
          sourceId,
          targetId,
          relation: "sequel",
        });
      else next.push(...(sequels.get(targetId) ?? []));
    }
  }
  return {
    currentAnimeId: current,
    ids: [...selectedIds].sort(),
    edges: [...projected.values()],
    externalEdges: (() => {
      const links = new Map<string, Edge>();
      const add = (edge: Edge) => {
        if (
          !visibleIds.has(edge.sourceId) ||
          !visibleIds.has(edge.targetId) ||
          selectedIds.has(edge.sourceId) === selectedIds.has(edge.targetId)
        )
          return;
        const link = selectedIds.has(edge.sourceId)
          ? edge
          : { ...edge, sourceId: edge.targetId, targetId: edge.sourceId };
        links.set(`${link.sourceId}:${link.targetId}:${link.relation}`, link);
      };
      for (const edge of typed.values())
        if (!storyPairs.has(pair(edge.sourceId, edge.targetId))) add(edge);
      for (const [key, edge] of untyped)
        if (!typedPairs.has(key)) add({ ...edge, relation: "other" });
      return [...links.values()];
    })(),
  };
}

export function compareFranchiseAnime(a: Anime, b: Anime) {
  const premiere = (anime: Anime) => {
    const value = Date.parse(anime.details?.airedAt ?? "");
    return Number.isFinite(value) ? value : Date.UTC(anime.year, 0, 1);
  };
  return (
    premiere(a) - premiere(b) ||
    a.year - b.year ||
    a.title.localeCompare(b.title, "ru") ||
    a.id.localeCompare(b.id)
  );
}

export async function animeFranchise(
  db: Database | undefined,
  config: Configuration,
  slug: string,
): Promise<AnimeFranchise | null> {
  if (config.DEMO_CATALOG === "true") {
    const current = developmentAnime.find((anime) => anime.slug === slug);
    if (!current) return null;
    const graph = resolveFranchise(
      developmentAnime.map((anime) => ({
        id: anime.id,
        published: true,
        isDevelopment: true,
        metadataProvider: "manual",
        details: anime.details ?? {},
        providers: [],
      })),
      current.id,
    )!;
    return franchiseSchema.parse({
      currentAnimeId: graph.currentAnimeId,
      characters: developmentCharacters.flatMap((character) => {
        const appearances = character.appearances
          .filter((entry) => graph.ids.includes(entry.anime.id))
          .map((entry) => ({ animeId: entry.anime.id, role: entry.role }));
        return appearances.length ? [{ character, appearances }] : [];
      }),
      items: developmentAnime
        .filter((anime) => graph.ids.includes(anime.id))
        .sort(compareFranchiseAnime)
        .map((anime) => ({ anime, episodes: [] })),
    });
  }
  if (!db) throw new ServiceUnavailableException("Catalog database is not configured.");
  const visible = {
    published: true,
    ...(config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
  };
  const current = await db.anime.findFirst({
    where: { slug, ...visible },
    select: { id: true, details: true },
  });
  if (!current) return null;
  await refreshShikimoriFranchise(db, current.id, current.details);
  if (config.NODE_ENV !== "test" && (await refreshAnimeCharacters(db, current.id)))
    invalidateCharacterIndex(db);
  // Keep visibility flags in the graph input so explicitly hidden titles cannot
  // be mistaken for absent provider nodes and used as bridges.
  const rows = await db.anime.findMany({
    select: {
      id: true,
      published: true,
      isDevelopment: true,
      metadataProvider: true,
      details: true,
      providers: {
        where: { provider: { in: ["shikimori", "kodik-material"] } },
        select: { provider: true, externalId: true },
      },
    },
    orderBy: { id: "asc" },
    take: franchiseGraphLimit + 1,
  });
  const graph = resolveFranchise(rows, current.id, config.NODE_ENV === "production");
  if (!graph) return null;
  const selected = await db.anime.findMany({
    where: { ...visible, metadataProvider: { not: "legacy" }, id: { in: graph.ids } },
    take: franchiseLimits.items,
  });
  if (!selected.some((anime) => anime.id === graph.currentAnimeId)) return null;
  const selectedIds = selected.map((anime) => anime.id);
  if (graph.externalEdges.length > franchiseLimits.externalLinks)
    throw new ServiceUnavailableException(
      "Franchise exceeds its supported number of external links.",
    );
  const externalIds = [...new Set(graph.externalEdges.map((edge) => edge.targetId))];
  const external = externalIds.length
    ? await db.anime.findMany({
        where: { ...visible, metadataProvider: { not: "legacy" }, id: { in: externalIds } },
        take: franchiseLimits.externalLinks,
      })
    : [];
  const externalAnime = new Map(
    (await enrichAnime(db, external)).map((anime) => [anime.id, anime]),
  );
  const episodes = await db.episode.findMany({
    where: { animeId: { in: selectedIds } },
    select: { id: true, animeId: true, season: true, number: true, duration: true },
    orderBy: [{ animeId: "asc" }, { id: "asc" }],
    take: franchiseLimits.episodes + 1,
  });
  if (episodes.length > franchiseLimits.episodes)
    throw new ServiceUnavailableException("Franchise exceeds its supported number of episodes.");
  episodes.sort(
    (a, b) =>
      a.season.localeCompare(b.season, "ru", { numeric: true }) ||
      a.number.localeCompare(b.number, "ru", { numeric: true }) ||
      a.id.localeCompare(b.id),
  );
  const groupedEpisodes = new Map<string, ReturnType<typeof episodeSchema.parse>[]>();
  for (const episode of episodes) {
    const group = groupedEpisodes.get(episode.animeId) ?? [];
    group.push(episodeSchema.parse(episode));
    groupedEpisodes.set(episode.animeId, group);
  }
  return franchiseSchema.parse({
    currentAnimeId: graph.currentAnimeId,
    externalLinks: graph.externalEdges.flatMap((edge) => {
      const anime = externalAnime.get(edge.targetId);
      return anime && selectedIds.includes(edge.sourceId)
        ? [{ sourceId: edge.sourceId, anime, relation: edge.relation }]
        : [];
    }),
    characters: await franchiseCharacters(db, selectedIds, config.NODE_ENV === "production"),
    edges: graph.edges.filter(
      (edge) => selectedIds.includes(edge.sourceId) && selectedIds.includes(edge.targetId),
    ),
    items: (await enrichAnime(db, selected))
      .sort(compareFranchiseAnime)
      .map((anime) => ({ anime, episodes: groupedEpisodes.get(anime.id) ?? [] })),
  });
}
