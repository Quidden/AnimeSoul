import { createDatabase } from "@animesoul/database";
import { readConfig } from "../config.js";
import { ProviderUnavailable, ProvidersService } from "./providers.service.js";
import { kodikPage, normalizeKodikAnime, saveKodikAnime } from "./kodik-catalog.js";
const config = readConfig();
if (!config.DATABASE_URL) throw new Error("A catalog database is required.");
const pages = Number(process.argv.find((arg) => arg.startsWith("--pages="))?.slice(8) ?? "1");
if (
  !Number.isInteger(pages) ||
  pages < 1 ||
  pages > 20 ||
  process.argv.some((arg) => arg.startsWith("--q="))
)
  throw new Error("Import accepts --pages=1..20. Use catalog:sync for the full Kodik catalog.");
const database = createDatabase(config.DATABASE_URL),
  provider = new ProvidersService(config, fetch);
let cursor: string | null = null,
  imported = 0,
  conflicts = 0;
try {
  const seen = new Set<string>();
  for (let i = 0; i < pages; i++) {
    const page = kodikPage(await provider.catalog(cursor), cursor);
    const normalized = page.results.map(normalizeKodikAnime);
    const pageConflicts = await database.$transaction(
      async (tx) => {
        const setting = await tx.$queryRaw<
          { enabled: boolean }[]
        >`SELECT "enabled" FROM "ProviderSetting" WHERE "key" = 'kodik' FOR SHARE`;
        if (!setting[0]?.enabled) throw new ProviderUnavailable("disabled");
        let count = 0;
        for (const anime of normalized) count += (await saveKodikAnime(tx, anime)).conflicts;
        return count;
      },
      { timeout: 60000 },
    );
    conflicts += pageConflicts;
    imported += normalized.length;
    console.info("Kodik page " + (i + 1) + ": " + imported + " releases saved.");
    if (page.next === null) break;
    if (seen.has(page.next)) throw new Error("repeated-page");
    seen.add(page.next);
    cursor = page.next;
  }
  await database.auditEvent.create({
    data: {
      action: "catalog.import",
      objectId: "kodik",
      reason: "Imported " + imported + " releases; mapping conflicts " + conflicts + ".",
    },
  });
} finally {
  await provider.onModuleDestroy();
  await database.$disconnect();
}
