import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client.js";
import type { Prisma } from "../generated/client.js";
import type { Anime } from "@animesoul/contracts";
export function catalogFields(anime: Anime): Prisma.AnimeCreateInput {
  const value: Prisma.AnimeCreateInput = {
    id: anime.id,
    slug: anime.slug,
    title: anime.title,
    originalTitle: anime.originalTitle,
    aliases: anime.aliases,
    description: anime.description,
    year: anime.year,
    genres: anime.genres,
    poster: anime.poster,
    status: anime.status,
  };
  if (anime.shikimoriScore !== undefined) value.shikimoriScore = anime.shikimoriScore;
  if (anime.shikimoriVotes !== undefined) value.shikimoriVotes = anime.shikimoriVotes;
  if (anime.popularity !== undefined) value.popularity = anime.popularity;
  if (anime.format !== undefined) value.format = anime.format;
  if (anime.translations !== undefined) value.translations = anime.translations;
  if (anime.franchiseSize !== undefined) value.franchiseSize = anime.franchiseSize;
  if (anime.details !== undefined)
    value.details = JSON.parse(JSON.stringify(anime.details)) as Prisma.InputJsonObject;
  return value;
}
export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3000, max: 10 }),
  });
}
export type Database = ReturnType<typeof createDatabase>;

export { Prisma } from "../generated/client.js";
export type DatabaseTransaction = import("../generated/client.js").Prisma.TransactionClient;
