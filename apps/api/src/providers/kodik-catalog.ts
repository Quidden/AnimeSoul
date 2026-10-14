import { createHash } from "node:crypto";
import { animeSchema, type Anime } from "@animesoul/contracts";
import type { Database, DatabaseTransaction } from "@animesoul/database";
import { record } from "./normalizers.js";
import { saveNormalizedAnime } from "./catalog-import.js";
import { catalogMetadata } from "./catalog-metadata.js";

function text(value: unknown, limit = 300) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function externalId(value: unknown) {
  const v = String(value ?? "");
  return /^\d{1,15}$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0
    ? String(Number(v))
    : null;
}
function texts(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((v) => text(v))
        .filter(Boolean)
        .slice(0, 100)
    : [];
}
export function normalizeKodikAnime(value: unknown) {
  const row = record(value),
    data = record(row.material_data);
  if (
    !["anime", "anime-serial"].includes(String(row.type)) ||
    !/^(movie|serial)-[1-9]\d{0,14}$/.test(String(row.id))
  )
    throw new Error("invalid-kodik-material");
  const shikimori = externalId(row.shikimori_id),
    kp = externalId(row.kinopoisk_id);
  const identity = shikimori
    ? "shikimori:" + shikimori
    : kp
      ? "kinopoisk:" + kp
      : "release:" + row.id;
  const hash = createHash("sha256")
    .update("animesoul:catalog:kodik:" + identity)
    .digest("hex")
    .slice(0, 32);
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
  const title = text(data.anime_title) || text(data.title) || text(row.title);
  if (!title) throw new Error("invalid-kodik-material");
  let poster: string | null = null;
  try {
    const url = new URL(text(data.anime_poster_url, 2048) || text(data.poster_url, 2048));
    if (url.protocol === "https:" && !url.username && !url.password) poster = url.href;
  } catch {
    /* Optional metadata. */
  }
  const status = text(data.anime_status) || text(data.all_status);
  const metadata = catalogMetadata(row, "kodik");
  const year = metadata.year ?? Number(data.year ?? row.year);
  const providers = [
    { provider: "kodik-material", externalId: identity },
    ...(shikimori ? [{ provider: "shikimori", externalId: shikimori }] : []),
    ...(kp ? [{ provider: "kinopoisk", externalId: kp }] : []),
  ];
  return {
    releaseId: String(row.id),
    providers,
    anime: animeSchema.parse({
      ...metadata,
      id,
      slug: "anime-" + id,
      indexable: false,
      title,
      originalTitle: text(data.title_en) || text(row.title_orig),
      aliases: [
        ...new Set(
          [
            ...texts(data.other_titles),
            ...texts(data.other_titles_en),
            ...texts(data.other_titles_jp),
            text(row.other_title),
          ].filter(Boolean),
        ),
      ].slice(0, 100),
      description: (text(data.anime_description, 20000) || text(data.description, 20000)).replace(
        /<[^>]*>/g,
        "",
      ),
      year: Number.isInteger(year) && year >= 0 && year <= 2200 ? year : 0,
      genres: [
        ...new Set(texts(data.anime_genres).length ? texts(data.anime_genres) : texts(data.genres)),
      ],
      poster,
      status:
        status === "ongoing"
          ? "ongoing"
          : ["anons", "announced"].includes(status)
            ? "announced"
            : "released",
    }),
  };
}

/** Validate cursor URLs but persist only the opaque next parameter, never the token or video URLs. */
export function kodikPage(value: unknown, current: string | null) {
  const row = record(value);
  if (row.error || !Array.isArray(row.results) || row.results.length > 100)
    throw new Error("invalid-page");
  const results = row.results as unknown[];
  const ids = results.map((item) => record(item).id);
  if (
    ids.some((id) => typeof id !== "string" || !/^(movie|serial)-[1-9]\d{0,14}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("invalid-page");
  let next: string | null = null;
  if (row.next_page !== null && row.next_page !== undefined && row.next_page !== "") {
    try {
      const url = new URL(String(row.next_page));
      next = url.searchParams.get("next");
      if (
        url.origin !== "https://kodik-api.com" ||
        url.pathname !== "/list" ||
        url.username ||
        url.password ||
        !next ||
        !/^[a-zA-Z0-9_=-]{1,512}$/.test(next) ||
        next === current ||
        !results.length
      )
        throw new Error();
    } catch {
      throw new Error("invalid-page");
    }
  }
  const total = Number(row.total);
  return {
    results,
    next,
    total: Number.isInteger(total) && total >= 0 && total <= 1000000 ? total : null,
    fingerprint: createHash("sha256").update(JSON.stringify(ids)).digest("hex"),
  };
}
function names(anime: Pick<Anime, "title" | "originalTitle" | "aliases">) {
  return new Set(
    [anime.title, anime.originalTitle, ...anime.aliases]
      .map((v) =>
        v
          .normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, ""),
      )
      .filter(Boolean),
  );
}
export function sameMaterial(
  a: Pick<Anime, "title" | "originalTitle" | "aliases" | "year">,
  b: Pick<Anime, "title" | "originalTitle" | "aliases" | "year">,
) {
  const titles = names(a);
  return (!a.year || !b.year || a.year === b.year) && [...names(b)].some((v) => titles.has(v));
}

export async function saveKodikAnime(
  tx: DatabaseTransaction,
  normalized: ReturnType<typeof normalizeKodikAnime>,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731006, 3)`;
  const primary = normalized.providers[0]!;
  const existing = await tx.animeProvider.findUnique({ where: { provider_externalId: primary } });
  let chosen = existing?.animeId;
  if (!chosen) {
    // Shared Kinopoisk IDs can span seasons; use the primary material's exact external ID.
    const secondary = normalized.providers.slice(1, 2);
    // Reuse an existing UUID only with an exact remote ID plus matching metadata; ambiguous candidates stay separate.
    const [owners, conflicts] = await Promise.all([
      tx.animeProvider.findMany({ where: { OR: secondary }, select: { animeId: true } }),
      tx.providerMappingConflict.findMany({
        where: { status: "open", OR: secondary },
        select: { incomingAnimeId: true },
        take: 100,
      }),
    ]);
    const candidateIds = [
      ...new Set([...owners.map((v) => v.animeId), ...conflicts.map((v) => v.incomingAnimeId)]),
    ];
    const candidates = await tx.anime.findMany({
      where: {
        id: { in: candidateIds },
        providers: {
          none: {
            OR: [
              { provider: "kodik-material" },
              ...secondary.map((mapping) => ({
                provider: mapping.provider,
                externalId: { not: mapping.externalId },
              })),
            ],
          },
        },
      },
      select: { id: true, title: true, originalTitle: true, aliases: true, year: true },
    });
    const matching = candidates.filter((candidate) => sameMaterial(candidate, normalized.anime));
    if (matching.length === 1) chosen = matching[0]!.id;
  }
  const id = chosen ?? normalized.anime.id;
  const release = await tx.kodikRelease.findUnique({ where: { id: normalized.releaseId } });
  if (release && release.animeId !== id) throw new Error("release-identity-changed");
  const result = await saveNormalizedAnime(
    tx,
    { ...normalized, anime: { ...normalized.anime, id } },
    "kodik",
  );
  await tx.kodikRelease.upsert({
    where: { id: normalized.releaseId },
    create: { id: normalized.releaseId, animeId: result.id },
    update: {},
  });
  return result;
}
export async function saveImportedKodikAnime(database: Database, raw: unknown) {
  const normalized = normalizeKodikAnime(raw);
  return database.$transaction((tx) => saveKodikAnime(tx, normalized));
}
