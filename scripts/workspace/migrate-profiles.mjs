import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../../packages/database/dist/src/index.js";
import { importProfiles } from "../../apps/api/dist/migration/import-profiles.js";
const source = process.argv[2];
if (!source) throw new Error("Usage: pnpm profiles:import <storage.json> [identities.json]");
const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("This migration command requires a local database.");
function readJson(file) {
  const text = readFileSync(file, "utf8");
  if (text.length > 10 * 1024 * 1024) throw new Error("Migration input exceeds 10 MiB.");
  return JSON.parse(text);
}
const database = createDatabase(url.href);
try {
  const result = await importProfiles(
    database,
    readJson(source),
    process.argv[3] ? readJson(process.argv[3]) : {},
  );
  mkdirSync("artifacts/stage2", { recursive: true });
  const report = path.resolve("artifacts/stage2/profile-import.json");
  writeFileSync(
    report,
    JSON.stringify(
      { source: path.resolve(source), importedAt: new Date().toISOString(), profiles: result },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.info(
    `Profiles: ${result.length}; imported: ${result.filter((p) => !p.skipped).length}; unchanged: ${result.filter((p) => p.skipped).length}. Private report: ${report}`,
  );
} catch (error) {
  console.error(
    "Profile import stopped; current transaction rolled back. Error type: " +
      (error instanceof Error ? error.name : "Error"),
  );
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
