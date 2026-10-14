import { spawn } from "node:child_process";
import path from "node:path";
const original = new URL(process.env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1"].includes(original.hostname) ||
  original.port !== "54329" ||
  original.pathname !== "/animesoul"
)
  throw new Error("Requires the local AnimeSoul cluster.");
for (const name of ["animesoul", "animesoul_test"]) {
  const url = new URL(original);
  url.pathname = "/" + name;
  console.log("Checking " + name);
  const child = spawn(
    process.execPath,
    [
      path.resolve("packages/database/node_modules/prisma/build/index.js"),
      "migrate",
      "diff",
      "--config",
      "prisma.config.ts",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
      ...(process.argv.includes("--sql") ? ["--script"] : []),
    ],
    {
      cwd: path.resolve("packages/database"),
      env: { ...process.env, DATABASE_URL: url.href },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) process.exitCode = code ?? 1;
}
