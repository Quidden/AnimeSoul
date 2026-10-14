import { animeDetailsSchema } from "@animesoul/contracts";
import type { Database } from "@animesoul/database";
import { publicRequest } from "./shikimori-metadata.js";

const pending = new Map<string, Promise<void>>();
const failed = new Map<string, number>();
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// /franchise returns real directed relationships for the whole franchise in one
// request. Store provider identities, then reconcile them with local canonical IDs.
export function parseShikimoriFranchise(value: unknown, currentId: string) {
  const data = object(value);
  if (
    String(data.current_id) !== currentId ||
    !Array.isArray(data.nodes) ||
    data.nodes.length > 512 ||
    !Array.isArray(data.links) ||
    data.links.length > 4096
  )
    throw new Error("Invalid franchise metadata.");
  const nodes = new Set(
    data.nodes.map((n) => String(object(n).id)).filter((id) => /^\d{1,15}$/.test(id)),
  );
  nodes.add(currentId);
  const edges = data.links
    .map((l) => object(l))
    .flatMap((l) => {
      const sourceId = String(l.source_id),
        targetId = String(l.target_id),
        relation = String(l.relation);
      return nodes.has(sourceId) &&
        nodes.has(targetId) &&
        sourceId !== targetId &&
        /^[a-z_]{1,40}$/.test(relation)
        ? [{ sourceId, targetId, relation }]
        : [];
    });
  return edges;
}

export async function refreshShikimoriFranchise(
  db: Database,
  animeId: string,
  savedDetails: unknown,
) {
  const saved = animeDetailsSchema.safeParse(savedDetails);
  if (
    saved.success &&
    saved.data.franchiseRelations &&
    Date.parse(saved.data.franchiseFetchedAt ?? "") > Date.now() - 86400000
  )
    return;
  const existing = pending.get(animeId);
  if (existing) return existing;
  if (pending.size >= 4 || (failed.get(animeId) ?? 0) > Date.now()) return;
  const task = (async () => {
    try {
      const refs = await db.animeProvider.findMany({
        where: { animeId, provider: { in: ["shikimori", "kodik-material"] } },
        select: { provider: true, externalId: true },
      });
      const id =
        refs
          .find((r) => r.provider === "kodik-material" && /^shikimori:\d{1,15}$/.test(r.externalId))
          ?.externalId.slice(10) ?? refs.find((r) => r.provider === "shikimori")?.externalId;
      if (!id || !/^\d{1,15}$/.test(id)) return;
      const relations = parseShikimoriFranchise(await publicRequest(id, "/franchise"), id);
      // Re-read after the network request: another metadata refresh may have run.
      const latest = await db.anime.findUnique({
        where: { id: animeId },
        select: { details: true },
      });
      if (!latest) return;
      const details = animeDetailsSchema.safeParse(latest.details);
      await db.anime.update({
        where: { id: animeId },
        data: {
          details: {
            ...(details.success ? details.data : {}),
            franchiseFetchedAt: new Date().toISOString(),
            franchiseRelations: relations,
          },
        },
      });
      failed.delete(animeId);
    } catch {
      if (failed.size >= 1000) failed.delete(failed.keys().next().value!);
      failed.set(animeId, Date.now() + 300000);
    }
  })();
  pending.set(animeId, task);
  try {
    await task;
  } finally {
    pending.delete(animeId);
  }
}
