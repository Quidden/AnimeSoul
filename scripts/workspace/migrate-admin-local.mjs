import { spawn } from "node:child_process";
import path from "node:path";
const original = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(original.hostname) ||
  original.port !== "54329" ||
  original.pathname !== "/animesoul"
)
  throw new Error("Requires the existing local AnimeSoul cluster.");
for (const name of ["animesoul_test", "animesoul"]) {
  const url = new URL(original);
  url.pathname = "/" + name;
  const child = spawn(
    process.execPath,
    [
      path.resolve("packages/database/node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      "prisma.config.ts",
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
  if (code !== 0) throw new Error("Additive admin migration failed for " + name);
}
