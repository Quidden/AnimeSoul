import { randomInt } from "node:crypto";
import { animeSchema, type CatalogQuery, type Anime } from "@animesoul/contracts";
import type { Configuration } from "../config.js";
import { developmentAnime } from "@animesoul/database/fixtures";
import type { Database, Prisma } from "@animesoul/database";

export async function enrichAnime(
  db: Database | undefined,
  rows: { id: string; isDevelopment?: boolean }[],
) {
  const scores =
    db && rows.length
      ? await db.libraryItem.groupBy({
          by: ["animeId"],
          where: {
            animeId: { in: rows.map((r) => r.id) },
            score: { not: null },
            user: { disabledAt: null },
          },
          _avg: { score: true },
          _count: { score: true },
        })
      : [];
  const averages = new Map(scores.map((s) => [s.animeId, s]));
  return rows.map((row) =>
    animeSchema.parse({
      ...row,
      indexable: !row.isDevelopment,
      communityScore: averages.get(row.id)?._avg.score ?? null,
      communityVotes: averages.get(row.id)?._count.score ?? 0,
    }),
  );
}

function catalogWhere(input: CatalogQuery, production: boolean): Prisma.AnimeWhereInput {
  return {
    published: true,
    metadataProvider: { not: "legacy" },
    ...(production ? { isDevelopment: false } : {}),
    ...(input.q
      ? {
          searchText: {
            contains: input.q.replace(/[\\%_]/g, (m) => "\\" + m),
            mode: "insensitive",
          },
        }
      : {}),
    ...(input.genre ? { genres: { has: input.genre } } : {}),
    ...(input.excludeGenre ? { NOT: { genres: { has: input.excludeGenre } } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.format ? { format: input.format } : {}),
    ...(input.translation ? { translations: { has: input.translation } } : {}),
    ...(input.group ? { franchiseSize: input.group === "franchise" ? { gt: 1 } : 1 } : {}),
    ...(input.from || input.to
      ? {
          year: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
    ...(input.minRating !== undefined && input.ratingSource === "shikimori"
      ? { shikimoriScore: { gte: input.minRating } }
      : {}),
  };
}

export async function genrePreferences(db: Database, userId: string) {
  const [progress, library] = await Promise.all([
    db.episodeProgress.findMany({
      where: { userId },
      select: {
        animeId: true,
        watchedSeconds: true,
        completed: true,
        position: true,
        anime: { select: { genres: true } },
      },
      take: 20000,
    }),
    db.libraryItem.findMany({
      where: { userId },
      select: { animeId: true, progressDetails: true, anime: { select: { genres: true } } },
      take: 5000,
    }),
  ]);
  const weights = new Map<string, number>(),
    started = new Set<string>();
  const add = (id: string, genres: string[], weight: number) => {
    if (weight <= 0) return;
    started.add(id);
    for (const genre of new Set(genres))
      weights.set(genre, (weights.get(genre) ?? 0) + weight / Math.max(1, genres.length));
  };
  for (const p of progress)
    add(
      p.animeId,
      p.anime.genres,
      (p.completed ? 1 : 0) +
        Math.min(p.watchedSeconds, 14400) / 3600 +
        (p.position > 0 ? 0.05 : 0),
    );
  for (const item of library) {
    if (started.has(item.animeId)) continue;
    let weight = 0;
    for (const raw of Object.values(
      item.progressDetails && typeof item.progressDetails === "object" ? item.progressDetails : {},
    )) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const p = raw as Record<string, unknown>;
      weight +=
        (p.completed ? 1 : 0) +
        Math.min(Number(p.watchedSeconds) || 0, 14400) / 3600 +
        (Number(p.position) > 0 || Number(p.percent) > 0 ? 0.05 : 0);
    }
    add(item.animeId, item.anime.genres, weight);
  }
  return {
    weights,
    started,
    preferredGenres: [...weights]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([genre, weight]) => ({ genre, weight })),
  };
}
export function tasteScore(genres: string[], weights: Map<string, number>) {
  return (
    [...new Set(genres)].reduce((sum, g) => sum + (weights.get(g) ?? 0), 0) /
    Math.max(1, genres.length)
  );
}

export async function listCatalog(
  db: Database | undefined,
  config: Configuration,
  input: CatalogQuery,
  userId?: string,
) {
  if (config.DEMO_CATALOG === "true") {
    const all = developmentAnime
      .filter(
        (a) =>
          (!input.q ||
            [a.title, a.originalTitle, ...a.aliases].some((t) =>
              t.toLowerCase().includes(input.q.toLowerCase()),
            )) &&
          (!input.genre || a.genres.includes(input.genre)) &&
          (!input.excludeGenre || !a.genres.includes(input.excludeGenre)) &&
          (!input.status || a.status === input.status) &&
          (!input.from || a.year >= input.from) &&
          (!input.to || a.year <= input.to) &&
          (!input.format || a.format === input.format) &&
          (!input.minRating || (a.shikimoriScore ?? 0) >= input.minRating),
      )
      .sort(
        (a, b) =>
          (input.sort === "rating"
            ? (b.shikimoriScore ?? -1) - (a.shikimoriScore ?? -1)
            : input.sort === "rating-asc"
              ? (a.shikimoriScore ?? 11) - (b.shikimoriScore ?? 11)
              : input.sort === "popular"
                ? (b.popularity ?? 0) - (a.popularity ?? 0)
                : input.sort === "newest"
                  ? b.year - a.year
                  : input.sort === "oldest"
                    ? a.year - b.year
                    : 0) || a.title.localeCompare(b.title, "ru"),
      );
    const pages = Math.max(1, Math.ceil(all.length / input.pageSize)),
      page = Math.min(input.page, pages);
    return {
      source: "development",
      items: all.slice((page - 1) * input.pageSize, page * input.pageSize),
      total: all.length,
      page,
      pages,
      pageSize: input.pageSize,
      genres: [...new Set(developmentAnime.flatMap((a) => a.genres))].sort(),
      translations: [],
      preferredGenres: [],
    };
  }
  if (!db) throw new Error("Catalog database is not configured.");
  let where = catalogWhere(input, config.NODE_ENV === "production");
  let orderedIds: string[] | undefined;
  let preferredGenres: { genre: string; weight: number }[] = [];
  let myScores = new Map<string, number | null>();
  if (input.ratingSource === "mine") {
    const rows = await db.libraryItem.findMany({
      where: { userId: userId ?? "", score: { gte: input.minRating ?? 1 } },
      select: { animeId: true, score: true },
      orderBy: [{ score: input.sort === "rating-asc" ? "asc" : "desc" }, { animeId: "asc" }],
    });
    myScores = new Map(rows.map((r) => [r.animeId, r.score]));
    orderedIds = rows.map((r) => r.animeId);
    where = { AND: [where, { id: { in: orderedIds } }] };
  } else if (input.ratingSource === "community") {
    const rows = await db.libraryItem.groupBy({
      by: ["animeId"],
      where: { score: { not: null }, user: { disabledAt: null } },
      _avg: { score: true },
      having: { score: { _avg: { gte: input.minRating ?? 0 } } },
      orderBy: { _avg: { score: input.sort === "rating-asc" ? "asc" : "desc" } },
    });
    orderedIds = rows.map((r) => r.animeId);
    where = { AND: [where, { id: { in: orderedIds } }] };
  }
  if (input.personalized === "1") {
    const preference = await genrePreferences(db, userId ?? "");
    preferredGenres = preference.preferredGenres;
    const candidates = preference.weights.size
      ? await db.anime.findMany({
          where: {
            AND: [
              where,
              {
                id: { notIn: [...preference.started] },
                status: { not: "announced" },
                genres: { hasSome: [...preference.weights.keys()] },
              },
            ],
          },
          select: { id: true, genres: true, shikimoriScore: true },
        })
      : [];
    orderedIds = candidates
      .map((a) => ({ ...a, weight: tasteScore(a.genres, preference.weights) }))
      .filter((a) => a.weight > 0)
      .sort(
        (a, b) =>
          b.weight - a.weight ||
          (b.shikimoriScore ?? 0) - (a.shikimoriScore ?? 0) ||
          a.id.localeCompare(b.id),
      )
      .map((a) => a.id);
    where = { AND: [where, { id: { in: orderedIds } }] };
  }
  const orderBy: Prisma.AnimeOrderByWithRelationInput[] = [
    ...(input.sort === "newest" || input.sort === "oldest"
      ? [{ year: input.sort === "newest" ? ("desc" as const) : ("asc" as const) }]
      : []),
    ...(input.sort === "popular" ? [{ popularity: "desc" as const }] : []),
    ...(input.sort === "rating" || input.sort === "rating-asc"
      ? [
          {
            shikimoriScore: {
              sort: input.sort === "rating" ? ("desc" as const) : ("asc" as const),
              nulls: "last" as const,
            },
          },
        ]
      : []),
    { title: "asc" },
    { id: "asc" },
  ];
  if (orderedIds) {
    const matches = await db.anime.findMany({ where, select: { id: true } });
    const allowed = new Set(matches.map((r) => r.id));
    orderedIds = orderedIds.filter((id) => allowed.has(id));
  }
  const total = orderedIds ? orderedIds.length : await db.anime.count({ where });
  const pages = Math.max(1, Math.ceil(total / input.pageSize)),
    page = Math.min(input.page, pages);
  const slice = orderedIds?.slice((page - 1) * input.pageSize, page * input.pageSize);
  const rows = await db.anime.findMany({
    where: slice ? { id: { in: slice } } : where,
    orderBy,
    ...(slice ? {} : { skip: (page - 1) * input.pageSize }),
    take: input.pageSize,
  });
  if (slice) {
    const rank = new Map(slice.map((id, i) => [id, i]));
    rows.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }
  const genres = await db.$queryRaw<
    { genre: string }[]
  >`SELECT DISTINCT unnest("genres") AS genre FROM "Anime" WHERE "published" AND "metadataProvider" <> 'legacy' AND (${config.NODE_ENV !== "production"} OR NOT "isDevelopment") ORDER BY genre`;
  const translations = await db.$queryRaw<
    { translation: string }[]
  >`SELECT DISTINCT unnest("translations") AS translation FROM "Anime" WHERE "published" AND "metadataProvider" <> 'legacy' AND (${config.NODE_ENV !== "production"} OR NOT "isDevelopment") ORDER BY translation`;
  const items = (await enrichAnime(db, rows)).map((a) => ({
    ...a,
    ...(myScores.has(a.id) ? { myScore: myScores.get(a.id) ?? null } : {}),
  }));
  return {
    source: "database",
    items,
    total,
    page,
    pages,
    pageSize: input.pageSize,
    genres: genres.map((g) => g.genre),
    translations: translations.map((t) => t.translation),
    preferredGenres,
  };
}

export async function randomAnime(
  db: Database | undefined,
  config: Configuration,
  input: CatalogQuery,
  mode: string,
  userId?: string,
): Promise<Anime | null> {
  if (config.DEMO_CATALOG === "true") {
    const result = await listCatalog(db, config, input);
    return result.items.length ? (result.items[randomInt(result.items.length)] ?? null) : null;
  }
  if (!db) return null;
  if (mode === "taste") {
    const preference = await genrePreferences(db, userId ?? "");
    if (!preference.weights.size) return null;
    const ratingIds =
      input.ratingSource === "mine"
        ? (
            await db.libraryItem.findMany({
              where: { userId: userId!, score: { gte: input.minRating ?? 1 } },
              select: { animeId: true },
            })
          ).map((r) => r.animeId)
        : input.ratingSource === "community"
          ? (
              await db.libraryItem.groupBy({
                by: ["animeId"],
                where: { score: { not: null }, user: { disabledAt: null } },
                _avg: { score: true },
                having: { score: { _avg: { gte: input.minRating ?? 0 } } },
              })
            ).map((r) => r.animeId)
          : undefined;
    const candidates = await db.anime.findMany({
      where: {
        AND: [
          catalogWhere(input, config.NODE_ENV === "production"),
          ...(ratingIds ? [{ id: { in: ratingIds } }] : []),
          {
            id: { notIn: [...preference.started] },
            status: { not: "announced" },
            genres: { hasSome: [...preference.weights.keys()] },
          },
        ],
      },
    });
    const weighted = candidates
      .map((a) => ({ anime: a, weight: tasteScore(a.genres, preference.weights) }))
      .filter((a) => a.weight > 0);
    let target = (randomInt(1000000000) / 1000000000) * weighted.reduce((s, a) => s + a.weight, 0);
    const chosen = weighted.find((a) => (target -= a.weight) < 0)?.anime;
    return chosen ? ((await enrichAnime(db, [chosen]))[0] ?? null) : null;
  }
  const where = catalogWhere(input, config.NODE_ENV === "production");
  if (input.ratingSource !== "shikimori" || input.personalized === "1") {
    const result = await listCatalog(db, config, { ...input, page: 1, pageSize: 1 }, userId);
    if (!result.total) return null;
    const selected = await listCatalog(
      db,
      config,
      { ...input, page: randomInt(result.total) + 1, pageSize: 1 },
      userId,
    );
    return selected.items[0] ?? null;
  }
  const count = await db.anime.count({ where });
  const selected = count
    ? await db.anime.findMany({ where, skip: randomInt(count), take: 1, orderBy: { id: "asc" } })
    : [];
  return (await enrichAnime(db, selected))[0] ?? null;
}
