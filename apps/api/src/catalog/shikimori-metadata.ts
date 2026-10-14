import { setTimeout } from "node:timers/promises";
import { animeDetailsSchema, publicMediaUrl } from "@animesoul/contracts";
import type { Database } from "@animesoul/database";
type AnimeRow = Awaited<ReturnType<Database["anime"]["findFirstOrThrow"]>>;
const pending = new Map<string, Promise<AnimeRow>>();
let nextRequest = 0;
export async function publicRequest(id: string, suffix = "") {
  return publicShikimoriRequest(`/animes/${id}${suffix}`);
}
export async function publicShikimoriRequest(path: string, signal?: AbortSignal) {
  if (
    !/^\/(?:animes\/\d{1,15}(?:\/(?:roles|related|franchise))?|characters\/(?:\d{1,15}|search\?search=[^#]*))$/.test(
      path,
    )
  )
    throw new Error("Invalid metadata path.");
  const wait = Math.max(0, nextRequest - Date.now());
  if (wait > 2500) throw new Error("Metadata source busy.");
  nextRequest = Math.max(Date.now(), nextRequest) + 1000;
  if (wait) await setTimeout(wait, undefined, { signal });
  const response = await fetch(`https://shikimori.one/api${path}`, {
    headers: { "User-Agent": "AnimeSoul", Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000),
  });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 1048576)
    throw new Error("Metadata unavailable.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Metadata unavailable.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 1048576) {
      await reader.cancel();
      throw new Error("Metadata too large.");
    }
    chunks.push(item.value);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function integer(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
export function parseShikimoriRelated(value: unknown, currentId: string) {
  if (!Array.isArray(value)) throw new Error("Invalid related metadata.");
  return value.slice(0, 100).flatMap((entry) => {
    const data = object(entry);
    const targetId = String(object(data.anime).id ?? "");
    const relation = String(data.relation ?? "")
      .toLowerCase()
      .replaceAll(/[-\s]+/g, "_");
    return /^\d{1,15}$/.test(targetId) && targetId !== currentId && /^[a-z_]{1,40}$/.test(relation)
      ? [{ sourceId: currentId, targetId, relation }]
      : [];
  });
}
export async function refreshShikimoriMetadata(db: Database, anime: AnimeRow): Promise<AnimeRow> {
  const saved = animeDetailsSchema.safeParse(anime.details);
  if (saved.success && Date.parse(saved.data.shikimoriFetchedAt ?? "") > Date.now() - 86400000)
    return anime;
  const identities = await db.animeProvider.findMany({
    where: { animeId: anime.id, provider: { in: ["shikimori", "kodik-material"] } },
    select: { provider: true, externalId: true },
  });
  const primary = identities.find(
    (r) => r.provider === "kodik-material" && r.externalId.startsWith("shikimori:"),
  );
  const mapping = primary
    ? { externalId: primary.externalId.slice(10) }
    : identities.find((r) => r.provider === "shikimori");
  if (!mapping || !/^\d{1,15}$/.test(mapping.externalId) || pending.size >= 4) return anime;
  const existing = pending.get(anime.id);
  if (existing) return existing;
  const task = (async () => {
    try {
      const data = object(await publicRequest(mapping.externalId));
      if (String(data.id) !== mapping.externalId) throw new Error("Metadata identity mismatch.");
      let relatedIds = saved.success ? (saved.data.relatedAnimeIds ?? []) : [];
      let relatedRelations = saved.success ? saved.data.relatedRelations : undefined;
      try {
        const related = await publicRequest(mapping.externalId, "/related");
        relatedRelations = parseShikimoriRelated(related, mapping.externalId);
        const external = relatedRelations.map((relation) => relation.targetId);
        const rows = external.length
          ? await db.animeProvider.findMany({
              where: {
                OR: [
                  { provider: "shikimori", externalId: { in: [mapping.externalId, ...external] } },
                  {
                    provider: "kodik-material",
                    externalId: {
                      in: [mapping.externalId, ...external].map((id) => "shikimori:" + id),
                    },
                  },
                ],
              },
              select: { animeId: true, provider: true, externalId: true },
              orderBy: { anime: { year: "asc" } },
            })
          : [];
        const primaryIds = new Map(
          rows
            .filter((r) => r.provider === "kodik-material")
            .map((r) => [r.externalId.slice(10), r.animeId]),
        );
        const replacements = new Map(
          rows
            .filter((r) => r.provider === "shikimori")
            .map((r) => [r.animeId, primaryIds.get(r.externalId) ?? r.animeId]),
        );
        if (rows.length)
          relatedIds = [
            ...new Set([
              ...relatedIds.map((id) => replacements.get(id) ?? id),
              ...rows.map(
                (r) =>
                  primaryIds.get(
                    r.provider === "shikimori" ? r.externalId : r.externalId.slice(10),
                  ) ?? r.animeId,
              ),
            ]),
          ].slice(0, 100);
      } catch {
        /* Cached franchise identities remain useful when the source is unavailable. */
      }
      const videos = Array.isArray(data.videos)
        ? data.videos
            .map((v) => object(v))
            .filter((v) => v.kind === "pv" || v.kind === "cm")
            .map((v) => v.url)
            .filter((v): v is string => typeof v === "string" && publicMediaUrl(v))
            .slice(0, 10)
        : [];
      const date = (v: unknown) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : undefined;
      const details = animeDetailsSchema.parse({
        ...(saved.success ? saved.data : {}),
        shikimoriFetchedAt: new Date().toISOString(),
        duration: integer(data.duration),
        episodesTotal: integer(data.episodes),
        episodesAired: integer(data.episodes_aired),
        airedAt: date(data.aired_on),
        releasedAt: date(data.released_on),
        nextEpisodeAt: date(data.next_episode_at),
        ...(Array.isArray(data.studios)
          ? {
              studios: data.studios
                .map((s) => String(object(s).name ?? ""))
                .filter(Boolean)
                .slice(0, 30),
            }
          : {}),
        ...(typeof data.rating === "string"
          ? { ageRating: data.rating.slice(0, 100).toUpperCase().replaceAll("_", " ") }
          : {}),
        ...(relatedIds.length ? { relatedAnimeIds: relatedIds } : {}),
        ...(relatedRelations ? { relatedRelations } : {}),
        ...(videos.length ? { trailerUrls: videos } : {}),
      });
      const score = Number(data.score),
        format = String(data.kind);
      const latest = await db.anime.findUnique({
        where: { id: anime.id },
        select: { details: true },
      });
      const graph = animeDetailsSchema.safeParse(latest?.details);
      if (graph.success && graph.data.franchiseFetchedAt) {
        details.franchiseFetchedAt = graph.data.franchiseFetchedAt;
        if (graph.data.franchiseRelations)
          details.franchiseRelations = graph.data.franchiseRelations;
      }
      return await db.anime.update({
        where: { id: anime.id },
        data: {
          details: JSON.parse(JSON.stringify(details)),
          ...(score > 0 && score <= 10 ? { shikimoriScore: score } : {}),
          ...(details.airedAt &&
          Number(details.airedAt.slice(0, 4)) >= 1900 &&
          Number(details.airedAt.slice(0, 4)) <= 2200
            ? { year: Number(details.airedAt.slice(0, 4)) }
            : {}),
          ...(["tv", "movie", "ova", "ona", "special", "music"].includes(format) ? { format } : {}),
          ...(relatedIds.length > 1 ? { franchiseSize: relatedIds.length } : {}),
        },
      });
    } catch {
      return anime;
    }
  })().finally(() => pending.delete(anime.id));
  pending.set(anime.id, task);
  return task;
}
