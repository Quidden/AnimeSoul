import { createDatabase } from "../../packages/database/dist/src/index.js";
import { readConfig } from "../../apps/api/dist/config.js";
import { ProvidersService } from "../../apps/api/dist/providers/providers.service.js";
import { catalogMetadata } from "../../apps/api/dist/providers/catalog-metadata.js";
import { kodikPage } from "../../apps/api/dist/providers/kodik-catalog.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
const config = readConfig();
const url = new URL(config.DATABASE_URL);
if (
  config.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Metadata refresh requires the local AnimeSoul database.");
const db = createDatabase(url.href);
const providers = new ProvidersService(config, fetch);
mkdirSync("artifacts/catalog-restore", { recursive: true });
try {
  if ((await providers.state("kodik")) !== "enabled") throw new Error("Kodik is not enabled.");
  const backup = path.resolve(`artifacts/catalog-restore/metadata-${Date.now()}.json`);
  writeFileSync(
    backup,
    JSON.stringify(
      await db.anime.findMany({
        select: {
          id: true,
          year: true,
          shikimoriScore: true,
          shikimoriVotes: true,
          popularity: true,
          format: true,
          translations: true,
          details: true,
        },
      }),
    ),
    { mode: 0o600 },
  );
  console.info("Metadata snapshot saved: " + backup);
  let cursor = null,
    pages = 0,
    updated = 0;
  do {
    let value;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        value = await providers.catalog(cursor);
        break;
      } catch (error) {
        if (attempt === 3)
          throw new Error("Metadata source unavailable: " + (error.code ?? "request-failed"), {
            cause: error,
          });
        await setTimeout(Math.min(60000, error.retryMs || 2000));
      }
    }
    const page = kodikPage(value, cursor);
    const releases = await db.kodikRelease.findMany({
      where: { id: { in: page.results.map((r) => r.id) } },
      select: { id: true, animeId: true },
    });
    const byRelease = new Map(releases.map((r) => [r.id, r.animeId]));
    const updates = new Map();
    for (const raw of page.results) {
      const id = byRelease.get(raw.id);
      if (!id) continue;
      const metadata = catalogMetadata(raw, "kodik");
      const previous = updates.get(id);
      updates.set(id, {
        ...previous,
        ...metadata,
        id,
        translations: [
          ...new Set([...(previous?.translations || []), ...(metadata.translations || [])]),
        ],
        details: { ...previous?.details, ...metadata.details },
      });
    }
    updated += await db.$executeRaw`UPDATE "Anime" a SET
      "shikimoriScore" = CASE WHEN a."details"->>'shikimoriFetchedAt' > ${new Date(Date.now() - 86400000).toISOString()} THEN a."shikimoriScore" ELSE COALESCE(m."shikimoriScore",a."shikimoriScore") END,
      "shikimoriVotes" = COALESCE(m."shikimoriVotes",a."shikimoriVotes"),
      "popularity" = COALESCE(m."popularity",a."popularity"),
      "format" = CASE WHEN a."details"->>'shikimoriFetchedAt' > ${new Date(Date.now() - 86400000).toISOString()} THEN a."format" ELSE COALESCE(m."format",a."format") END,
      "year" = CASE WHEN a."details"->>'shikimoriFetchedAt' > ${new Date(Date.now() - 86400000).toISOString()} THEN a."year" ELSE COALESCE(m."year",a."year") END,
      "translations" = ARRAY(SELECT DISTINCT unnest(a."translations" || m."translations")),
      "details" = CASE WHEN a."details"->>'shikimoriFetchedAt' > ${new Date(Date.now() - 86400000).toISOString()} THEN m."details" || a."details" ELSE a."details" || m."details" END
      FROM jsonb_to_recordset(${JSON.stringify([...updates.values()])}::jsonb) AS m(id uuid,"shikimoriScore" double precision,"shikimoriVotes" integer,"popularity" integer,"format" text,"year" integer,"translations" text[],"details" jsonb)
      WHERE a.id = m.id`;
    cursor = page.next;
    pages++;
    if (pages % 20 === 0 || !cursor) console.info({ pages, updated });
    await setTimeout(300);
  } while (cursor && pages < 1000);
  if (cursor) throw new Error("Metadata page limit exceeded.");
  console.info({
    complete: true,
    pages,
    updated,
    rated: await db.anime.count({
      where: { published: true, metadataProvider: "kodik", shikimoriScore: { not: null } },
    }),
  });
} finally {
  await providers.onModuleDestroy();
  await db.$disconnect();
}
