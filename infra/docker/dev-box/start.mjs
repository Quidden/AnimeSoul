import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, chmod, unlink } from "node:fs/promises";
import path from "node:path";
import { createDatabase } from "@animesoul/database";
import { privateVisibility } from "@animesoul/contracts";
import { hashPassword, newTotpSecret, encryptSecret } from "../dist/auth/security.js";

process.umask(0o077);
const data = process.env.DEV_BOX_DATA ?? "/var/lib/postgresql/animesoul-dev";
const databaseDirectory = path.join(data, "postgres");
const privateFile = path.join(data, "private.json");
const children = [];
let stopping = false;
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function run(command, args, env = process.env, capture = false) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  let output = "";
  if (capture)
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
  return output.trim();
}
function start(name, command, args, env) {
  const child = spawn(command, args, { env, stdio: "inherit", cwd: "/app/api" });
  children.push({ name, child });
  child.once("error", (error) => {
    console.error(`${name}: ${error.message}`);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped (${code ?? signal}).`);
      void shutdown(1);
    }
  });
  return child;
}
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  // Stop application writers before PostgreSQL; SIGINT performs a fast, clean PG shutdown.
  for (const { name, child } of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const done = new Promise((resolve) => child.once("exit", resolve));
    child.kill(name === "postgres" ? "SIGINT" : "SIGTERM");
    await Promise.race([
      done,
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 8000);
        timer.unref();
      }),
    ]);
  }
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

try {
  await mkdir(data, { recursive: true });
  let state;
  if (await exists(privateFile)) state = JSON.parse(await readFile(privateFile, "utf8"));
  else {
    if (await exists(path.join(databaseDirectory, "PG_VERSION")))
      throw new Error("Existing database without dev-box credentials; refusing to adopt it.");
    state = {
      version: 1,
      databasePassword: randomBytes(32).toString("hex"),
      mfaEncryptionKey: randomBytes(32).toString("hex"),
      internalProxySecret: randomBytes(32).toString("hex"),
      account: {
        id: randomUUID(),
        email: "dev-owner@example.test",
        username: "DevOwner",
        password: process.env.DEV_ACCOUNT_PASSWORD || randomBytes(24).toString("base64url"),
        totpSecret: newTotpSecret(),
      },
    };
    if (state.account.password.length < 12 || state.account.password.length > 128)
      throw new Error("DEV_ACCOUNT_PASSWORD must contain 12–128 characters.");
    await writeFile(privateFile, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
  }
  await chmod(privateFile, 0o600);
  if (state.version !== 1) throw new Error("Unsupported dev-box volume version.");
  if (!state.internalProxySecret) {
    state.internalProxySecret = randomBytes(32).toString("hex");
    await writeFile(privateFile, JSON.stringify(state) + "\n", { mode: 0o600 });
  }
  const pgEnv = {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    PGUSER: "animesoul",
    PGPASSWORD: state.databasePassword,
  };
  if (!(await exists(path.join(databaseDirectory, "PG_VERSION")))) {
    const passwordFile = path.join(data, "database-password");
    await writeFile(passwordFile, state.databasePassword + "\n", { mode: 0o600 });
    await run("initdb", [
      "-D",
      databaseDirectory,
      "-U",
      "animesoul",
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--pwfile",
      passwordFile,
    ]);
    await unlink(passwordFile);
  }
  start(
    "postgres",
    "postgres",
    [
      "-D",
      databaseDirectory,
      "-h",
      "127.0.0.1",
      "-k",
      data,
      "-p",
      "5432",
      "-c",
      "max_connections=150",
    ],
    pgEnv,
  );
  for (let attempt = 0; ; attempt++) {
    try {
      await run("pg_isready", ["-q", "-d", "postgres"], pgEnv);
      break;
    } catch {
      if (attempt >= 60 || stopping) throw new Error("PostgreSQL did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const sql = (statement) =>
    run(
      "psql",
      ["-d", "animesoul_dev", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement],
      pgEnv,
      true,
    );
  const databaseExists = await run(
    "psql",
    [
      "-d",
      "postgres",
      "-At",
      "-c",
      "SELECT count(*) FROM pg_database WHERE datname='animesoul_dev'",
    ],
    pgEnv,
    true,
  );
  if (databaseExists === "0") await run("createdb", ["animesoul_dev"], pgEnv);
  const snapshot = JSON.parse(await readFile("/app/dev-snapshot/manifest.json", "utf8"));
  for (const name of ["schema", "catalog"]) {
    const hash = createHash("sha256")
      .update(await readFile(`/app/dev-snapshot/${name}.dump`))
      .digest("hex");
    if (hash !== snapshot.sha256[name]) throw new Error(`Snapshot checksum mismatch: ${name}`);
  }
  // Restore schema and catalog in one transaction. A failed first boot can be retried safely.
  const tableCount = await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'");
  if (tableCount === "0") {
    const restore = path.join(data, "restore.sql");
    const schemaSql = await run(
      "pg_restore",
      [
        "--no-owner",
        "--no-privileges",
        "--section=pre-data",
        "--file=-",
        "/app/dev-snapshot/schema.dump",
      ],
      pgEnv,
      true,
    );
    const catalogSql = await run(
      "pg_restore",
      ["--no-owner", "--no-privileges", "--file=-", "/app/dev-snapshot/catalog.dump"],
      pgEnv,
      true,
    );
    const constraintsSql = await run(
      "pg_restore",
      [
        "--no-owner",
        "--no-privileges",
        "--section=post-data",
        "--file=-",
        "/app/dev-snapshot/schema.dump",
      ],
      pgEnv,
      true,
    );
    // Restore foreign keys after the data, validating the copied relationships.
    await writeFile(restore, schemaSql + "\n" + catalogSql + "\n" + constraintsSql + "\n", {
      mode: 0o600,
    });
    await run(
      "psql",
      ["-d", "animesoul_dev", "--single-transaction", "-q", "-v", "ON_ERROR_STOP=1", "-f", restore],
      pgEnv,
    );
    await unlink(restore);
    for (const table of snapshot.tables) {
      const count = Number(await sql(`SELECT count(*) FROM public."${table}"`));
      if (count !== snapshot.counts[table]) throw new Error(`Restored row count differs: ${table}`);
    }
    console.info(
      `Restored full catalog: ${snapshot.counts.Anime} anime, ${snapshot.counts.Character} characters.`,
    );
  }
  const databaseUrl = `postgresql://animesoul:${state.databasePassword}@127.0.0.1:5432/animesoul_dev`;
  await run(
    "node",
    [
      "/app/migrate/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--config",
      "/app/migrate/prisma.config.ts",
    ],
    { ...pgEnv, DATABASE_URL: databaseUrl },
  );
  const db = createDatabase(databaseUrl);
  try {
    // Remove the old preview-only restriction without removing accounts or their data.
    await db.$executeRawUnsafe('DROP INDEX IF EXISTS "dev_box_single_account"');
    const owner = await db.user.findUnique({ where: { id: state.account.id } });
    if (!owner) {
      if ((await db.user.count()) > 0)
        throw new Error(
          "Bootstrap owner is missing from this volume; refusing to replace accounts.",
        );
      const passwordHash = await hashPassword(state.account.password);
      await db.user.create({
        data: {
          id: state.account.id,
          email: state.account.email,
          passwordHash,
          emailVerifiedAt: new Date(),
          profile: {
            create: {
              username: state.account.username,
              usernameKey: state.account.username.toLowerCase(),
              visibility: privateVisibility,
              content: {},
              about: "Тестовый аккаунт владельца AnimeSoul",
            },
          },
          roles: { create: [{ role: "owner" }, { role: "admin" }] },
          permissions: {
            create: [{ permission: "providers.yummy.manage", grantedBy: state.account.id }],
          },
          mfa: {
            create: {
              secretEncrypted: encryptSecret(
                state.account.totpSecret,
                state.mfaEncryptionKey,
                state.account.id,
              ),
              recoveryHashes: [],
              enabledAt: new Date(),
            },
          },
        },
      });
    }
    for (const key of ["kodik", "yummy"])
      await db.providerSetting.upsert({
        where: { key },
        create: { key, enabled: true },
        update: {},
      });
  } finally {
    await db.$disconnect();
  }
  for (const folder of ["profile-media", "diagnostics", "dev-mail"])
    await mkdir(path.join(data, folder), { recursive: true });
  const common = {
    ...process.env,
    DEMO_CATALOG: "false",
    LOCAL_POSTGRES: "false",
    API_URL: "http://127.0.0.1:8020",
    NEXT_TELEMETRY_DISABLED: "1",
    PUBLIC_INDEXING: process.env.PUBLIC_INDEXING || "false",
    INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET || state.internalProxySecret,
    INTERNAL_PROXY_TRUSTED_IPS: "127.0.0.1,::1",
    INTERNAL_PROXY_TRUSTED_HOSTS: "",
    DIAGNOSTICS_DIR: path.join(data, "diagnostics"),
  };
  const backend = {
    ...common,
    DATABASE_URL: databaseUrl,
    NODE_ENV: process.env.APP_ENV || "development",
    API_HOST: "0.0.0.0",
    API_PORT: "8020",
    SITE_URL: process.env.SITE_URL ?? "http://localhost:18021",
    ADMIN_URL: process.env.ADMIN_URL ?? "http://localhost:18022",
    MFA_ENCRYPTION_KEY: state.mfaEncryptionKey,
    PROFILE_MEDIA_DIR: path.join(data, "profile-media"),
    MAIL_MODE: process.env.MAIL_MODE || "disabled",
  };
  start("api", "node", ["/app/api/dist/main.js"], backend);
  start("worker", "node", ["/app/api/dist/providers/catalog-worker.js"], backend);
  start("web", "node", ["/app/web/apps/web/server.js"], {
    ...common,
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
    PORT: "8021",
  });
  start("admin", "node", ["/app/admin/apps/admin/server.js"], {
    ...common,
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
    PORT: "8022",
  });
  console.info(
    "Dev environment started. Read account credentials with: docker exec <container> node /app/api/dev-box/account.mjs",
  );
} catch (error) {
  const message = error.name?.startsWith("Prisma")
    ? `Database initialization failed (${error.code ?? error.name})`
    : error.message;
  console.error(`Dev environment startup failed: ${message}`);
  await shutdown(1);
}
