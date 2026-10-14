import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Explicit allowlist: no users, sessions, billing, activity, settings JSON or import jobs.
export const snapshotTables = [
  "Anime",
  "AnimeProvider",
  "Character",
  "AnimeCharacter",
  "Episode",
  "EpisodeProvider",
  "KodikRelease",
  "ProviderMappingOverride",
  "SubscriptionPlan",
  "SubscriptionPromotion",
  "_prisma_migrations",
];
const source = process.env.DEV_SNAPSHOT_CONTAINER ?? "animesoul-postgres-1";
const directory = path.resolve("artifacts/dev-image");

async function docker(args, outputFile) {
  const child = spawn("docker", ["exec", source, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    error = "";
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Catalog export failed (${code}): ${error}`)),
    );
  });
  if (outputFile) await Promise.all([pipeline(child.stdout, createWriteStream(outputFile)), done]);
  else {
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    await done;
  }
  return output.trim();
}
async function counts() {
  const sql =
    "SELECT jsonb_build_object(" +
    snapshotTables
      .flatMap((table) => [`'${table}'`, `(SELECT count(*) FROM public."${table}")`])
      .join(",") +
    ")";
  return JSON.parse(
    await docker([
      "psql",
      "-U",
      "animesoul",
      "-d",
      "animesoul",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]),
  );
}
await mkdir(directory, { recursive: true });
const before = await counts();
if (before.Anime < 1000) throw new Error("Expected the full catalog, not development fixtures.");
for (const [name, options] of [
  ["schema", ["--schema-only"]],
  ["catalog", ["--data-only", ...snapshotTables.map((table) => `--table=public."${table}"`)]],
]) {
  const partial = path.join(directory, `${name}.partial`);
  await docker(
    [
      "pg_dump",
      "-U",
      "animesoul",
      "-d",
      "animesoul",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      ...options,
    ],
    partial,
  );
  if ((await stat(partial)).size < 1000) throw new Error(`${name} snapshot is unexpectedly small.`);
  await rename(partial, path.join(directory, `${name}.dump`));
}
const after = await counts();
if (snapshotTables.some((table) => before[table] !== after[table]))
  throw new Error("Catalog changed during export. Run the snapshot command again before building.");
const sha256 = {};
for (const name of ["schema", "catalog"])
  sha256[name] = createHash("sha256")
    .update(await readFile(path.join(directory, `${name}.dump`)))
    .digest("hex");
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  tables: snapshotTables,
  counts: after,
  sha256,
};
await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.info(JSON.stringify(manifest, null, 2));
