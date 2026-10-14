import { spawn } from "node:child_process";
import path from "node:path";
import { run } from "./run.mjs";
import { checkDevelopment } from "./dev-status.mjs";
import { openDevelopmentSite } from "./open-development-site.mjs";
const openWebsite = process.argv.includes("--open");
async function checkPorts() {
  const result = await checkDevelopment();
  if (result === 10 && openWebsite) await openDevelopmentSite();
  if (result !== 0) process.exit(result === 10 ? 0 : result);
}
await checkPorts();
if (process.env.LOCAL_POSTGRES === "true") await run(["db:local"]);
for (const [name, script] of [
  ["database", "generate"],
  ["contracts", "build"],
  ["database", "build"],
  ["api", "build"],
])
  await run(["--filter", "@animesoul/" + name, script]);
await checkPorts();
const children = [
  spawn(process.execPath, ["apps/api/dist/main.js"], { stdio: "inherit" }),
  ...(process.env.CATALOG_WORKER === "true"
    ? [spawn(process.execPath, ["apps/worker/main.mjs"], { stdio: "inherit" })]
    : []),
  ...["web", "admin"].map((name) =>
    spawn(
      process.execPath,
      [
        path.resolve("apps/" + name + "/node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        name === "web" ? "8021" : "8022",
      ],
      { cwd: path.resolve("apps/" + name), stdio: "inherit" },
    ),
  ),
];
let stopping = false;
const browserWait = new AbortController();
function stop() {
  if (stopping) return;
  stopping = true;
  browserWait.abort();
  for (const child of children) {
    if (process.platform === "win32" && child.pid)
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.once("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
if (openWebsite) {
  void openDevelopmentSite({ signal: browserWait.signal })
    .then(() => console.info("Opened AnimeSoul: http://localhost:8021"))
    .catch((error) => {
      if (stopping) return;
      console.error(error.message);
      console.info("Open the website manually: http://localhost:8021");
    });
}
