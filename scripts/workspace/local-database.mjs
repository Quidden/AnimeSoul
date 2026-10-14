import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

// An isolated development cluster; never manages the machine's PostgreSQL service.
const root = path.resolve("artifacts/postgres");
const bin = process.env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "54329")
  throw new Error("Local database commands require loopback port 54329.");
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
async function run(name, args, input, allowFailure = false) {
  const executable = path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  const child = spawn(executable, args, {
    env,
    stdio: ["pipe", allowFailure ? "ignore" : "inherit", allowFailure ? "ignore" : "inherit"],
    windowsHide: true,
  });
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0 && !allowFailure) throw new Error("PostgreSQL command failed: " + name);
  return code;
}
const action = process.argv[2] ?? "start";
if (action === "stop") {
  await run("pg_ctl", ["-D", root, "stop", "-m", "fast", "-w"]);
} else if (action === "start") {
  if (!existsSync(path.join(root, "PG_VERSION"))) {
    mkdirSync(root, { recursive: true });
    const passwordFile = path.resolve("artifacts/postgres-password.tmp");
    writeFileSync(passwordFile, decodeURIComponent(url.password), { mode: 0o600, flag: "wx" });
    try {
      await run("initdb", [
        "-D",
        root,
        "-U",
        decodeURIComponent(url.username),
        "--pwfile",
        passwordFile,
        "-A",
        "scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      unlinkSync(passwordFile);
    }
  }
  if ((await run("pg_ctl", ["-D", root, "status"], undefined, true)) !== 0)
    await run("pg_ctl", [
      "-D",
      root,
      "-l",
      path.resolve("artifacts/postgres-server.log"),
      "-o",
      "-h 127.0.0.1 -p 54329",
      "start",
      "-w",
    ]);
  const args = [
    "-h",
    "127.0.0.1",
    "-p",
    "54329",
    "-U",
    decodeURIComponent(url.username),
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  // Fixed names and psql's identifier quoting keep database creation independent of shell input.
  await run(
    "psql",
    args,
    "SELECT format('CREATE DATABASE %I', name) FROM (VALUES ('animesoul'), ('animesoul_test')) AS names(name) WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = name)\\gexec\n",
  );
  console.info("Local PostgreSQL is ready on 127.0.0.1:54329.");
} else throw new Error("Use start or stop.");
