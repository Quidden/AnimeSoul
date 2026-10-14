import { setTimeout } from "node:timers/promises";
import { createDatabase } from "@animesoul/database";
import { readConfig } from "../config.js";
import { ProvidersService } from "./providers.service.js";
import { enqueueCatalog, runCatalogPage } from "./catalog-jobs.js";
const config = readConfig();
if (!config.DATABASE_URL) throw new Error("Catalog worker requires PostgreSQL.");
const database = createDatabase(config.DATABASE_URL);
const providers = new ProvidersService(config, fetch);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
try {
  if (process.argv.includes("--enqueue")) {
    console.info(await enqueueCatalog(database, null, "Local operator: full catalog import"));
  } else {
    console.info("Catalog worker ready.");
    do {
      try {
        const job = await runCatalogPage(database, providers);
        if (job)
          console.info({
            id: job.id,
            status: job.status,
            offset: job.offset,
            imported: job.imported,
            rejected: job.rejected,
            conflicts: job.conflicts,
            error: job.lastError,
          });
        if (process.argv.includes("--once")) break;
      } catch {
        console.error("Catalog worker database unavailable; retrying.");
      }
      await setTimeout(1500);
    } while (!stopping);
  }
} finally {
  await providers.onModuleDestroy();
  await database.$disconnect();
}
