import {
  characterSummarySchema,
  publicMediaUrl,
  voiceActorSchema,
  type AnimeCharacter,
  type CharacterRole,
} from "@animesoul/contracts";
import type { Database, DatabaseTransaction } from "@animesoul/database";
import { publicRequest, publicShikimoriRequest } from "./shikimori-metadata.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max = 300) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const identity = (value: unknown) => (/^[1-9]\d{0,14}$/.test(String(value)) ? String(value) : null);

export function characterPlainText(value: unknown) {
  return text(value, 100000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[(?:img|image)(?:=[^\]]*)?\][\s\S]*?\[\/(?:img|image)\]/gi, "")
    .replace(/\[\/?[a-z_]+(?:[= ][^\]]*)?\]/gi, "")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity] ?? "",
    )
    .replace(/&#(\d{1,6});/g, (_, code: string) => {
      const value = Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50000);
}
function media(value: unknown) {
  const raw = text(value, 4096);
  if (!raw || /\/missing(?:\.|\/)/i.test(raw)) return null;
  try {
    const url = new URL(raw, "https://shikimori.one");
    return publicMediaUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}
function source(value: unknown, kind: "characters" | "people", id: string) {
  const raw = text(value, 4096);
  try {
    const url = new URL(raw || `/${kind}/${id}`, "https://shikimori.one");
    return url.origin === "https://shikimori.one" &&
      new RegExp(`^/${kind}/${id}(?:-|$)`).test(url.pathname)
      ? url.href
      : `https://shikimori.one/${kind}/${id}`;
  } catch {
    return `https://shikimori.one/${kind}/${id}`;
  }
}
export function shikimoriCharacterSummary(value: unknown) {
  const row = object(value),
    id = identity(row.id);
  const originalName = text(row.name),
    name = text(row.russian) || originalName;
  if (!id || !name) throw new Error("Invalid character metadata.");
  const label =
    originalName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 130) || "character";
  return characterSummarySchema.parse({
    id,
    slug: `${id}-${label}`,
    name,
    originalName,
    aliases: [],
    image: media(object(row.image).original ?? object(row.image).preview),
  });
}
export function shikimoriCharacterRole(value: unknown): CharacterRole | null {
  const roles = (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase());
  if (roles.includes("main")) return "main";
  if (roles.includes("supporting")) return "supporting";
  if (roles.includes("background")) return "background";
  return null;
}
export function parseShikimoriCharacters(value: unknown): AnimeCharacter[] {
  if (!Array.isArray(value) || value.length > 4096) throw new Error("Invalid character roles.");
  const items = new Map<string, AnimeCharacter>();
  for (const raw of value) {
    const row = object(raw);
    if (!row.character) continue; // Staff entries are people, not characters.
    const role = shikimoriCharacterRole(row.roles);
    if (!role) continue;
    const character = shikimoriCharacterSummary(row.character);
    const previous = items.get(character.id);
    const priority = { main: 0, supporting: 1, background: 2 };
    if (!previous || priority[role] < priority[previous.role])
      items.set(character.id, { ...character, role });
  }
  if (items.size > 512) throw new Error("Character cast is too large.");
  return [...items.values()];
}
export function parseShikimoriCharacterDetails(value: unknown, expectedId: string) {
  const row = object(value),
    summary = shikimoriCharacterSummary(row);
  if (summary.id !== expectedId) throw new Error("Character identity mismatch.");
  const aliases = [
    ...new Set(
      (Array.isArray(row.altname) ? row.altname : text(row.altname, 15000).split(/[,;\n]/))
        .map((value) => text(value))
        .filter(Boolean),
    ),
  ].slice(0, 50);
  const voiceActors = (Array.isArray(row.seyu) ? row.seyu : []).slice(0, 50).flatMap((raw) => {
    const person = object(raw),
      id = identity(person.id),
      name = text(person.russian) || text(person.name);
    return id && name
      ? [
          voiceActorSchema.parse({
            id,
            name,
            image: media(object(person.image).original ?? object(person.image).preview),
            sourceUrl: source(person.url, "people", id),
          }),
        ]
      : [];
  });
  if (!Array.isArray(row.animes) || row.animes.length > 512)
    throw new Error("Invalid character appearances.");
  const appearances = row.animes.flatMap((raw) => {
    const anime = object(raw),
      externalId = identity(anime.id),
      role = shikimoriCharacterRole(anime.roles ?? anime.role);
    return externalId && role ? [{ externalId, role }] : [];
  });
  return {
    ...summary,
    japaneseName: text(row.japanese),
    aliases,
    description: characterPlainText(row.description || row.description_html),
    sourceUrl: source(row.url, "characters", expectedId),
    voiceActors,
    appearances,
  };
}

const pending = new WeakMap<Database, Map<string, Promise<boolean>>>();
const failures = new WeakMap<Database, Map<string, number>>();
async function refresh(db: Database, key: string, task: () => Promise<boolean>, force = false) {
  let tasks = pending.get(db);
  if (!tasks) pending.set(db, (tasks = new Map()));
  let failed = failures.get(db);
  if (!failed) failures.set(db, (failed = new Map()));
  const existing = tasks.get(key);
  if (existing) return existing;
  if (tasks.size >= 4 || (!force && (failed.get(key) ?? 0) > Date.now())) return false;
  const promise = task()
    .then((value) => {
      failed.delete(key);
      return value;
    })
    .catch(() => {
      if (failed.size >= 1000) failed.delete(failed.keys().next().value!);
      failed.set(key, Date.now() + 300000);
      return false;
    })
    .finally(() => tasks.delete(key));
  tasks.set(key, promise);
  return promise;
}

export async function refreshAnimeCharacters(
  db: Database,
  animeId: string,
  options: { force?: boolean } = {},
) {
  return refresh(
    db,
    `anime:${animeId}`,
    async () => {
      const anime = await db.anime.findUnique({
        where: { id: animeId },
        select: {
          charactersFetchedAt: true,
          providers: {
            where: { provider: { in: ["shikimori", "kodik-material"] } },
            select: { provider: true, externalId: true },
          },
        },
      });
      if (!anime) return false;
      if (
        !options.force &&
        anime.charactersFetchedAt &&
        anime.charactersFetchedAt.getTime() > Date.now() - 86400000
      )
        return true;
      const externalId =
        anime.providers
          .find(
            (ref) =>
              ref.provider === "kodik-material" && /^shikimori:[1-9]\d{0,14}$/.test(ref.externalId),
          )
          ?.externalId.slice(10) ??
        anime.providers.find((ref) => ref.provider === "shikimori")?.externalId;
      if (!externalId || !identity(externalId)) return false;
      const characters = parseShikimoriCharacters(await publicRequest(externalId, "/roles"));
      await db.$transaction(
        async (tx) => {
          for (const character of characters) {
            const { role, ...summary } = character;
            await tx.character.upsert({
              where: { id: character.id },
              create: {
                ...summary,
                japaneseName: summary.japaneseName ?? "",
                externalId: character.id,
                sourceUrl: `https://shikimori.one/characters/${character.id}`,
              },
              update: {
                name: summary.name,
                originalName: summary.originalName,
                ...(summary.image ? { image: summary.image } : {}),
              },
            });
            await tx.animeCharacter.upsert({
              where: { animeId_characterId: { animeId, characterId: character.id } },
              create: {
                animeId,
                characterId: character.id,
                role,
                position: characters.indexOf(character),
              },
              update: { role, position: characters.indexOf(character) },
            });
          }
          await tx.animeCharacter.deleteMany({
            where: { animeId, characterId: { notIn: characters.map((entry) => entry.id) } },
          });
          await tx.anime.update({
            where: { id: animeId },
            data: { charactersFetchedAt: new Date() },
          });
        },
        { timeout: 15000 },
      );
      return true;
    },
    options.force,
  );
}

export async function storeShikimoriCharacterDetails(
  db: Database,
  value: unknown,
  expectedId: string,
) {
  const details = parseShikimoriCharacterDetails(value, expectedId);
  const { appearances, voiceActors, ...character } = details;
  const externalIds = [...new Set(appearances.map((entry) => entry.externalId))];
  return db.$transaction(
    async (tx: DatabaseTransaction) => {
      const saved = await tx.character.upsert({
        where: { id: expectedId },
        create: {
          ...character,
          externalId: expectedId,
          voiceActors,
          appearanceExternalIds: externalIds,
          detailsFetchedAt: new Date(),
        },
        update: {
          name: character.name,
          originalName: character.originalName,
          japaneseName: character.japaneseName,
          aliases: character.aliases,
          description: character.description,
          image: character.image,
          sourceUrl: character.sourceUrl,
          voiceActors,
          appearanceExternalIds: externalIds,
          detailsFetchedAt: new Date(),
        },
      });
      const references = externalIds.length
        ? await tx.animeProvider.findMany({
            where: {
              OR: [
                { provider: "shikimori", externalId: { in: externalIds } },
                {
                  provider: "kodik-material",
                  externalId: { in: externalIds.map((id) => `shikimori:${id}`) },
                },
              ],
            },
            select: { animeId: true, provider: true, externalId: true },
          })
        : [];
      const primary = new Map(
        references
          .filter((ref) => ref.provider === "kodik-material")
          .map((ref) => [ref.externalId.slice(10), ref.animeId]),
      );
      const animeIds = new Set<string>();
      for (const ref of references) {
        const externalId =
          ref.provider === "kodik-material" ? ref.externalId.slice(10) : ref.externalId;
        const animeId = primary.get(externalId) ?? ref.animeId;
        if (animeId !== ref.animeId) continue;
        animeIds.add(animeId);
        const role = appearances.find((entry) => entry.externalId === externalId)!.role;
        await tx.animeCharacter.upsert({
          where: { animeId_characterId: { animeId, characterId: expectedId } },
          create: { animeId, characterId: expectedId, role },
          update: { role },
        });
      }
      await tx.animeCharacter.deleteMany({
        where: { characterId: expectedId, animeId: { notIn: [...animeIds] } },
      });
      return saved;
    },
    { timeout: 15000 },
  );
}
export async function refreshCharacterDetails(
  db: Database,
  characterId: string,
  options: { force?: boolean; signal?: AbortSignal } = {},
) {
  return refresh(
    db,
    `character:${characterId}`,
    async () => {
      const character = await db.character.findUnique({
        where: { id: characterId },
        select: { provider: true, externalId: true, detailsFetchedAt: true },
      });
      if (!character || character.provider !== "shikimori" || !identity(character.externalId))
        return false;
      if (
        !options.force &&
        character.detailsFetchedAt &&
        character.detailsFetchedAt.getTime() > Date.now() - 86400000
      )
        return true;
      await storeShikimoriCharacterDetails(
        db,
        await publicShikimoriRequest(`/characters/${character.externalId}`, options.signal),
        character.externalId,
      );
      return true;
    },
    options.force,
  );
}
