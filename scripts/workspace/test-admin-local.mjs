import { spawn } from "node:child_process";
import path from "node:path";
import { readdir } from "node:fs/promises";
const url = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Requires the local AnimeSoul cluster.");
url.pathname = "/animesoul_test";
const selected = process.argv.slice(2);
const files = selected.length
  ? selected
  : (
      await Promise.all(
        ["packages/contracts/tests", "apps/api/tests", "tests"].map(async (directory) =>
          (await readdir(directory))
            .filter((f) => f.endsWith(".test.mjs"))
            .map((f) => directory + "/" + f),
        ),
      )
    ).flat();
const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  env: {
    ...process.env,
    DATABASE_URL: url.href,
    TEST_DATABASE_URL: url.href,
    DIAGNOSTICS_DIR: path.resolve("artifacts/admin-modernization/test-diagnostics"),
  },
  stdio: "inherit",
  windowsHide: true,
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
process.exitCode = code ?? 1;
