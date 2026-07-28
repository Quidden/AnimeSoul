import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const stage = path.join(root, "desktop-stage");
const output = path.join(root, "desktop-release");
const requested = process.argv[2];
const targets = requested === "installer"
  ? ["nsis"]
  : requested === "portable"
    ? ["portable"]
    : ["nsis", "portable"];

async function findFile(directory, predicate) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(candidate, predicate);
      if (found) return found;
    } else if (predicate(entry.name)) {
      return candidate;
    }
  }
  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} завершился с кодом ${result.status ?? "unknown"}`);
  }
}

if (process.platform !== "win32") {
  throw new Error("Автоматическая desktop-сборка сейчас поддерживает Windows.");
}

const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("Переменная LOCALAPPDATA не найдена.");

const electronCache = path.join(localAppData, "electron", "Cache");
const builderCache = path.join(localAppData, "electron-builder", "Cache");
const electronZip = await findFile(electronCache, (name) => /^electron-v.+-win32-x64\.zip$/i.test(name));
const sevenZip = await findFile(builderCache, (name) => name.toLowerCase() === "7za.exe");
if (!electronZip || !sevenZip) {
  throw new Error("Кэш Electron не найден. Сначала один раз запусти electron-builder или npm run desktop:dir.");
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
run(sevenZip, ["x", electronZip, `-o${stage}`, "-x!resources/default_app.asar", "-y"]);
await rename(path.join(stage, "electron.exe"), path.join(stage, "AnimeSoul.exe"));

const appDir = path.join(stage, "resources", "app");
await mkdir(appDir, { recursive: true });
for (const directory of ["desktop", "launcher", "dist", "public"]) {
  await cp(path.join(root, directory), path.join(appDir, directory), { recursive: true });
}
for (const file of ["local-storage-server.mjs", "package.json"]) {
  await cp(path.join(root, file), path.join(appDir, file));
}

// Invoke the JavaScript entrypoint directly. Spawning a .cmd shim with
// shell=false is unreliable on newer Node.js versions on Windows.
const builder = path.join(root, "node_modules", "electron-builder", "cli.js");
for (const target of targets) {
  const folder = target === "nsis" ? "installer" : "portable";
  await rm(path.join(output, folder), { recursive: true, force: true });
  run(process.execPath, [
    builder,
    "--win",
    target,
    "--prepackaged",
    stage,
    `--config.directories.output=desktop-release/${folder}`,
  ]);
}

console.log(`Desktop-сборка готова: ${output}`);
