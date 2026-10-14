import { createDatabase } from "../../packages/database/dist/src/index.js";
import { refreshAnimeCharacters } from "../../apps/api/dist/catalog/shikimori-characters.js";
import { setTimeout } from "node:timers/promises";

const argumentsList = process.argv.slice(2);
if (argumentsList.some((value) => !/^--(?:limit=\d+|slug=[a-z0-9-]+)$/.test(value)))
  throw new Error("Usage: pnpm catalog:characters [--limit=50] [--slug=anime-slug]");
const limit = Number(argumentsList.find((value) => value.startsWith("--limit="))?.slice(8) ?? 50);
const slug = argumentsList.find((value) => value.startsWith("--slug="))?.slice(7);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
  throw new Error("Character refresh limit must be between 1 and 1000.");
const url = new URL(process.env.DATABASE_URL);
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Character refresh requires the local AnimeSoul database.");
const database = createDatabase(url.href);
try {
  const items = await database.anime.findMany({
    where: {
      published: true,
      metadataProvider: { not: "legacy" },
      isDevelopment: false,
      ...(slug
        ? { slug }
        : {
            OR: [
              { charactersFetchedAt: null },
              { charactersFetchedAt: { lt: new Date(Date.now() - 86400000) } },
            ],
          }),
      providers: {
        some: {
          OR: [
            { provider: "shikimori" },
            { provider: "kodik-material", externalId: { startsWith: "shikimori:" } },
          ],
        },
      },
    },
    select: { id: true, title: true },
    orderBy: [{ popularity: "desc" }, { id: "asc" }],
    take: slug ? 1 : limit,
  });
  let refreshed = 0;
  for (const [index, anime] of items.entries()) {
    const success = await refreshAnimeCharacters(database, anime.id);
    if (success) refreshed++;
    console.info(
      `${index + 1}/${items.length} ${success ? "Cached" : "Unavailable"}: ${anime.title}`,
    );
    if (index + 1 < items.length) await setTimeout(1100);
  }
  console.info(
    `Character casts refreshed: ${refreshed}/${items.length}. Cached profiles are retained.`,
  );
} finally {
  await database.$disconnect();
}
