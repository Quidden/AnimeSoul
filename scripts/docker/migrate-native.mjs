import { spawn } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

// Copies the isolated Windows development database into an EMPTY Compose database.
// The original cluster and private .env remain available for local development.
const source = new URL(process.env.DATABASE_URL ?? "");
if (
  process.platform !== "win32" ||
  !["127.0.0.1", "localhost"].includes(source.hostname) ||
  source.port !== "54329" ||
  source.pathname !== "/animesoul"
)
  throw new Error("This transfer requires the native local animesoul database on port 54329.");
const bin = process.env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const connection = [
  "-h",
  source.hostname,
  "-p",
  source.port,
  "-U",
  decodeURIComponent(source.username),
  "-d",
  "animesoul",
];
async function run(command, args, env = process.env) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (value) => {
    stdout += value;
  });
  child.stderr.on("data", (value) => {
    stderr += value;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`${path.basename(command)} failed (${code}): ${stderr}`);
  return stdout.trim();
}
const nativeEnv = { ...process.env, PGPASSWORD: decodeURIComponent(source.password) };
const targetSql = (sql) =>
  run("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
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
  ]);
const tableCount = "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'";
if ((await targetSql(tableCount)) !== "0")
  throw new Error("Target database already contains tables. Refusing to replace existing data.");
const native = (name, args) => run(path.join(bin, name + ".exe"), args, nativeEnv);
const countsSql = `SELECT coalesce(jsonb_object_agg(tablename,
  (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) FROM %I.%I',
  schemaname, tablename), false, true, '')))[1]::text::bigint), '{}'::jsonb)
  FROM pg_tables WHERE schemaname = 'public'`;
const sourceCounts = JSON.parse(await native("psql", [...connection, "-At", "-c", countsSql]));
if (!sourceCounts.User || !sourceCounts.Anime)
  throw new Error("Source does not contain the expected AnimeSoul accounts and catalog.");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.resolve("artifacts/database-backups");
await mkdir(directory, { recursive: true });
const backup = path.join(directory, `docker-transfer-${stamp}.dump`);
await native("pg_dump", [...connection, "-Fc", "--no-owner", "--no-privileges", "-f", backup]);
if ((await stat(backup)).size < 1024) throw new Error("Backup is unexpectedly small.");
console.info("Native database backup saved: " + backup);
await run("docker", ["compose", "cp", backup, "postgres:/tmp/animesoul-transfer.dump"]);
await run("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "pg_restore",
  "-U",
  "animesoul",
  "-d",
  "animesoul",
  "--no-owner",
  "--no-privileges",
  "--single-transaction",
  "--exit-on-error",
  "/tmp/animesoul-transfer.dump",
]);
const targetCounts = JSON.parse(await targetSql(countsSql));
const verified = JSON.stringify(sourceCounts) === JSON.stringify(targetCounts);
const report = path.join(directory, `docker-transfer-${stamp}.json`);
await writeFile(report, JSON.stringify({ backup, verified, sourceCounts, targetCounts }, null, 2), {
  flag: "wx",
  mode: 0o600,
});
if (!verified) throw new Error("Row counts differ. Keep the native database and inspect " + report);
await run("docker", ["compose", "exec", "-T", "postgres", "rm", "/tmp/animesoul-transfer.dump"]);
console.info(
  `Verified all ${Object.keys(targetCounts).length} tables; ` +
    `${targetCounts.User} users and ${targetCounts.Anime} anime. Report: ${report}`,
);
