import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_NAME, validatePort } from "./config.mjs";
import { ensureCliConfig } from "./setup-cli.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configFile = path.join(root, CONFIG_NAME);

function launch(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
}

async function waitForSite(url) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(url, { cache: "no-store" })).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Сайт не ответил по адресу ${url}`);
}

function openBrowser(url) {
  spawn("cmd.exe", ["/d", "/c", "start", "", url], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();
}

try {
  const config = await ensureCliConfig(configFile);
  const sitePort = config.sitePort;
  const url = `http://localhost:${sitePort}/`;
  try {
    if ((await fetch(url, { cache: "no-store" })).ok) {
      openBrowser(url);
      console.log(`AnimeSoul уже запущен: ${url}`);
      process.exit(0);
    }
  } catch {}
  const portCheck = await validatePort(config.sitePort);
  if (!portCheck.ok) throw new Error(portCheck.error);
  const storagePort = sitePort + 1;
  const env = {
    ...process.env,
    YUMMYANIME_TOKEN: config.yummyAnimeToken,
    ANIMESOUL_STORAGE_PORT: String(storagePort),
    ANIMESOUL_SITE_PORT: String(sitePort),
  };
  launch(process.execPath, [path.join(root, "local-storage-server.mjs")], env);
  launch("cmd.exe", ["/d", "/c", "npm.cmd", "run", "dev", "--", "--port", String(sitePort)], env);
  await waitForSite(url);
  openBrowser(url);
  console.log(`AnimeSoul запущен: ${url}`);
} catch (error) {
  console.error(`\nНе удалось запустить AnimeSoul: ${error instanceof Error ? error.message : error}`);
  console.error(`Проверь ${configFile}. Его можно изменить вручную при закрытом AnimeSoul.`);
  process.exitCode = 1;
}
