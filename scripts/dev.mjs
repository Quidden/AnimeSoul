import { spawn } from "node:child_process";
import path from "node:path";
import { run } from "./run.mjs";
for (const [name, script] of [
  ["database", "generate"],
  ["contracts", "build"],
  ["database", "build"],
  ["api", "build"],
])
  await run(["--filter", "@animesoul/" + name, script]);
const children = [
  spawn(process.execPath, ["apps/api/dist/main.js"], { stdio: "inherit" }),
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
function stop() {
  if (stopping) return;
  stopping = true;
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
