import { ServiceUnavailableException } from "@nestjs/common";
import {
  animeCharactersSchema,
  characterDetailsSchema,
  characterRoleSchema,
  characterSummarySchema,
  createSearchScorer,
  normalizeSearchText,
  voiceActorSchema,
  type CharacterSummary,
  type FranchiseCharacter,
} from "@animesoul/contracts";
import type { Database, Prisma } from "@animesoul/database";
import { developmentAnime, developmentCharacters } from "@animesoul/database/fixtures";
import type { Configuration } from "../config.js";
import { enrichAnime } from "./discovery.js";
import { publicShikimoriRequest } from "./shikimori-metadata.js";
import {
  parseShikimoriCharacterDetails,
  refreshAnimeCharacters,
  refreshCharacterDetails,
  shikimoriCharacterSummary,
  storeShikimoriCharacterDetails,
} from "./shikimori-characters.js";

export function visibleCharacterAnime(production: boolean): Prisma.AnimeWhereInput {
  return {
    published: true,
    metadataProvider: { not: "legacy" },
    ...(production ? { isDevelopment: false } : {}),
  };
}
function visibleCharacter(production: boolean): Prisma.CharacterWhereInput {
  return {
    ...(production ? { isDevelopment: false } : {}),
    appearances: { some: { anime: visibleCharacterAnime(production) } },
  };
}
export async function animeCharacters(
  db: Database | undefined,
  config: Configuration,
  slug: string,
) {
  if (config.DEMO_CATALOG === "true") {
    const anime = developmentAnime.find((entry) => entry.slug === slug);
    if (!anime) return null;
    return animeCharactersSchema.parse({
      items: developmentCharacters.flatMap((character) => {
        const appearance = character.appearances.find((entry) => entry.anime.id === anime.id);
        return appearance
          ? [{ ...characterSummarySchema.parse(character), role: appearance.role }]
          : [];
      }),
    });
  }
  if (!db) throw new ServiceUnavailableException("Catalog database is not configured.");
  const production = config.NODE_ENV === "production";
  const anime = await db.anime.findFirst({
    where: { slug, ...visibleCharacterAnime(production) },
    select: { id: true },
  });
  if (!anime) return null;
  if (config.NODE_ENV !== "test" && (await refreshAnimeCharacters(db, anime.id)))
    invalidateCharacterIndex(db);
  const rows = await db.animeCharacter.findMany({
    where: {
      animeId: anime.id,
      anime: visibleCharacterAnime(production),
      character: production ? { isDevelopment: false } : {},
    },
    include: { character: true },
    orderBy: [{ position: "asc" }, { characterId: "asc" }],
    take: 512,
  });
  return animeCharactersSchema.parse({
    items: rows.map((row) => ({ ...characterSummarySchema.parse(row.character), role: row.role })),
  });
}
export async function characterDetails(
  db: Database | undefined,
  config: Configuration,
  slug: string,
) {
  if (config.DEMO_CATALOG === "true")
    return developmentCharacters.find((entry) => entry.slug === slug) ?? null;
  if (!db) throw new ServiceUnavailableException("Catalog database is not configured.");
  const production = config.NODE_ENV === "production";
  let character = await db.character.findFirst({
    where: { slug, ...visibleCharacter(production) },
  });
  if (!character) return null;
  if (config.NODE_ENV !== "test" && (await refreshCharacterDetails(db, character.id)))
    invalidateCharacterIndex(db);
  character = await db.character.findFirst({
    where: { id: character.id, ...visibleCharacter(production) },
  });
  if (!character) return null;
  const rows = await db.animeCharacter.findMany({
    where: { characterId: character.id, anime: visibleCharacterAnime(production) },
    include: { anime: true },
    orderBy: [{ anime: { year: "asc" } }, { animeId: "asc" }],
    take: 512,
  });
  const anime = await enrichAnime(
    db,
    rows.map((row) => row.anime),
  );
  return characterDetailsSchema.parse({
    ...characterSummarySchema.parse(character),
    description: character.description,
    sourceUrl: character.sourceUrl,
    voiceActors: voiceActorSchema.array().max(50).parse(character.voiceActors),
    appearances: anime.map((entry) => ({
      anime: entry,
      role: rows.find((row) => row.animeId === entry.id)!.role,
    })),
  });
}
export async function franchiseCharacters(
  db: Database,
  animeIds: string[],
  production: boolean,
): Promise<FranchiseCharacter[]> {
  const rows = await db.animeCharacter.findMany({
    where: {
      animeId: { in: animeIds },
      anime: visibleCharacterAnime(production),
      character: production ? { isDevelopment: false } : {},
    },
    include: { character: true },
    orderBy: [{ position: "asc" }, { characterId: "asc" }],
    take: 131072,
  });
  const grouped = new Map<string, FranchiseCharacter>();
  for (const row of rows) {
    if (!grouped.has(row.characterId) && grouped.size >= 512) continue;
    const value = grouped.get(row.characterId) ?? {
      character: characterSummarySchema.parse(row.character),
      appearances: [],
    };
    value.appearances.push({ animeId: row.animeId, role: characterRoleSchema.parse(row.role) });
    grouped.set(row.characterId, value);
  }
  return [...grouped.values()];
}

type CachedCharacters = { until: number; items: CharacterSummary[] };
const indexes = new WeakMap<Database, Map<boolean, CachedCharacters>>();
export function invalidateCharacterIndex(db: Database) {
  indexes.delete(db);
}
async function characterIndex(db: Database, production: boolean) {
  let variants = indexes.get(db);
  if (!variants) indexes.set(db, (variants = new Map()));
  const saved = variants.get(production);
  if (saved && saved.until > Date.now()) return saved.items;
  const rows = await db.character.findMany({
    where: visibleCharacter(production),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 20000,
  });
  const items = rows.map((row) => characterSummarySchema.parse(row));
  variants.set(production, { until: Date.now() + 45000, items });
  return items;
}
function matchingCharacters(items: CharacterSummary[], text: string, preserveSourceOrder = false) {
  if (!text || text.startsWith("@")) return [];
  const score = createSearchScorer(normalizeSearchText(text));
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .map((row, position) => ({
      row,
      position,
      score: Math.max(
        ...[row.name, row.originalName, row.japaneseName ?? "", ...row.aliases].map((name) =>
          score(name),
        ),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      preserveSourceOrder
        ? a.position - b.position
        : b.score - a.score || a.row.name.localeCompare(b.row.name, "ru"),
    )
    .slice(0, 6)
    .map((entry) => entry.row);
}
const searches = new WeakMap<Database, Map<string, { until: number; pending?: Promise<void> }>>();
async function discoverCharacters(db: Database, text: string, production: boolean) {
  if (text.length < 2 || text.length > 80 || text.startsWith("@")) return;
  let queries = searches.get(db);
  if (!queries) searches.set(db, (queries = new Map()));
  const key = `${production}:${normalizeSearchText(text)}`,
    existing = queries.get(key);
  if (existing?.pending) return existing.pending;
  if (existing && existing.until > Date.now()) return;
  if (queries.size >= 128) queries.delete(queries.keys().next().value!);
  const entry: { until: number; pending?: Promise<void> } = { until: Date.now() + 60000 };
  const task = (async () => {
    const signal = AbortSignal.timeout(6000);
    const result = await publicShikimoriRequest(
      `/characters/search?search=${encodeURIComponent(text)}`,
      signal,
    );
    if (!Array.isArray(result) || result.length > 100) return;
    const candidates = matchingCharacters(
      result.flatMap((value) => {
        try {
          return [shikimoriCharacterSummary(value)];
        } catch {
          return [];
        }
      }),
      text,
      true,
    ).slice(0, 2);
    for (const candidate of candidates) {
      if (signal.aborted) break;
      const saved = await db.character.findUnique({
        where: { id: candidate.id },
        select: { detailsFetchedAt: true },
      });
      if (saved?.detailsFetchedAt && saved.detailsFetchedAt.getTime() > Date.now() - 86400000)
        continue;
      try {
        const payload = await publicShikimoriRequest(`/characters/${candidate.id}`, signal);
        const details = parseShikimoriCharacterDetails(payload, candidate.id);
        const externalIds = details.appearances.map((appearance) => appearance.externalId);
        const visible = externalIds.length
          ? await db.anime.findFirst({
              where: {
                ...visibleCharacterAnime(production),
                providers: {
                  some: {
                    OR: [
                      { provider: "shikimori", externalId: { in: externalIds } },
                      {
                        provider: "kodik-material",
                        externalId: { in: externalIds.map((id) => `shikimori:${id}`) },
                      },
                    ],
                  },
                },
              },
              select: { id: true },
            })
          : null;
        if (visible) await storeShikimoriCharacterDetails(db, payload, candidate.id);
      } catch {
        /* Other candidates and the local index remain usable. */
      }
    }
    invalidateCharacterIndex(db);
  })()
    .catch(() => {
      /* Return existing indexed characters when the provider is unavailable. */
    })
    .finally(() => {
      delete entry.pending;
    });
  entry.pending = task;
  queries.set(key, entry);
  return task;
}
export async function searchCharacters(
  db: Database | undefined,
  config: Configuration,
  text: string,
  options: { discover?: boolean } = {},
) {
  if (!text || text.startsWith("@")) return [];
  if (config.DEMO_CATALOG === "true")
    return matchingCharacters(
      developmentCharacters.map((entry) => characterSummarySchema.parse(entry)),
      text,
    );
  if (!db) return [];
  const production = config.NODE_ENV === "production";
  async function candidates() {
    const indexed = await characterIndex(db!, production);
    if (indexed.length < 20000) return indexed;
    // Exact/partial database candidates keep large catalogs searchable beyond the fuzzy index.
    const rows = await db!.character.findMany({
      where: {
        ...visibleCharacter(production),
        OR: [
          { name: { contains: text, mode: "insensitive" } },
          { originalName: { contains: text, mode: "insensitive" } },
          { japaneseName: { contains: text, mode: "insensitive" } },
          { aliases: { has: text } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 100,
    });
    return [...indexed, ...rows.map((row) => characterSummarySchema.parse(row))];
  }
  let matches = matchingCharacters(await candidates(), text);
  if (!matches.length && options.discover !== false && config.NODE_ENV !== "test") {
    await discoverCharacters(db, text, production);
    matches = matchingCharacters(await candidates(), text);
  }
  // Publication is checked again after the cache and every provider request.
  const rows = matches.length
    ? await db.character.findMany({
        where: { id: { in: matches.map((entry) => entry.id) }, ...visibleCharacter(production) },
        take: 6,
      })
    : [];
  const current = new Map(rows.map((row) => [row.id, characterSummarySchema.parse(row)]));
  return matches.flatMap((entry) => (current.has(entry.id) ? [current.get(entry.id)!] : []));
}
