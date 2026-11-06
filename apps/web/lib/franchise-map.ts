import type { Anime, AnimeFranchise } from "@animesoul/contracts";
import { mainStoryIds, partType, type PartType } from "./franchise-graph";

export type MapNode = { anime: Anime; type: PartType; x: number; y: number };
export type MapEdge = { from: MapNode; to: MapNode; main: boolean };

export const mapColumn = 128;
const rows = [86, 250, 414] as const;

const releaseTime = (anime: Anime) =>
  Date.parse(anime.details?.airedAt ?? "") ||
  (anime.year > 0 ? Date.UTC(anime.year, 0, 1) : Number.POSITIVE_INFINITY);

// A compact map for the anime page: the main story runs along the middle row in release
// order and every other part branches above or below it in the same chronological column.
export function franchiseMap(franchise: AnimeFranchise, hidden: ReadonlySet<PartType> = new Set()) {
  const main = mainStoryIds(franchise);
  const parts = franchise.items
    .map(({ anime }) => ({ anime, type: partType(anime, main) }))
    .filter((part) => !hidden.has(part.type))
    .sort(
      (a, b) =>
        releaseTime(a.anime) - releaseTime(b.anime) ||
        a.anime.title.localeCompare(b.anime.title, "ru"),
    );
  const spine = main.size > 0;
  let branch = 0;
  const nodes: MapNode[] = parts.map(({ anime, type }, index) => ({
    anime,
    type,
    x: 72 + index * mapColumn,
    y: (spine ? type === "main" : index === 0) ? rows[1] : branch++ % 2 === 0 ? rows[0] : rows[2],
  }));
  const byId = new Map(nodes.map((node) => [node.anime.id, node]));
  const seen = new Set<string>();
  const edges: MapEdge[] = [];
  for (const edge of franchise.edges) {
    const from = byId.get(edge.sourceId),
      to = byId.get(edge.targetId);
    if (!from || !to || from === to) continue;
    const key = [from.anime.id, to.anime.id].sort().join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const [first, second] = from.x <= to.x ? [from, to] : [to, from];
    edges.push({
      from: first,
      to: second,
      main:
        (edge.relation === "sequel" || edge.relation === "prequel") &&
        first.type === "main" &&
        second.type === "main",
    });
  }
  return {
    nodes,
    edges,
    width: Math.max(640, nodes.length * mapColumn + 16),
    height: 500,
  };
}
