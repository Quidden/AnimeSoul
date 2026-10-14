import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectDevelopment } from "./dev-status.mjs";

const website = "http://localhost:8021";

async function openBrowser() {
  const [executable, args] =
    process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", '"start "" "http://localhost:8021""']]
      : process.platform === "darwin"
        ? ["open", [website]]
        : ["xdg-open", [website]];
  const child = spawn(executable, args, {
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: process.platform === "win32",
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("The default browser could not be opened.")),
    );
  });
}

export async function openDevelopmentSite({
  options = {},
  signal,
  timeoutMs = 120000,
  intervalMs = 250,
  open = openBrowser,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("AnimeSoul did not become ready to open the website.");
    const status = await inspectDevelopment({
      ...options,
      timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 5000, remaining)),
    });
    signal?.throwIfAborted();
    if (status.state === "running") {
      await open(website);
      return;
    }
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())), undefined, { signal });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await openDevelopmentSite();
    console.info("Opened AnimeSoul: " + website);
  } catch (error) {
    console.error(error.message);
    console.error("Open the website manually: " + website);
    process.exitCode = 1;
  }
}
