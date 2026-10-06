import { spawn } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSiteServer } from "./site-server.mjs";
import { CONFIG_NAME, readConfig, saveConfig, validatePort, validateYummyToken } from "../launcher/config.mjs";

const IS_SMOKE_TEST = process.argv.includes("--smoke-test") || process.argv.includes("--player-smoke-test");
if (IS_SMOKE_TEST) app.setPath("userData", path.join(app.getPath("temp"), "AnimeSoulSmokeTest"));
let SITE_PORT = IS_SMOKE_TEST ? 32201 : 3001;
let STORAGE_PORT = SITE_PORT + 1;
let SITE_URL = `http://localhost:${SITE_PORT}/`;
let mainWindow;
let siteServer;
let storageProcess;
let zoomFactor = 1;
let zoomFile;
let launchMode = "desktop";
let launcherWindow;
let isStarting = true;

function getConfigFile(root) {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, CONFIG_NAME);
  if (!app.isPackaged) return path.join(root, CONFIG_NAME);
  return path.join(app.getPath("documents"), "AnimeSoul", CONFIG_NAME);
}

async function ensureDesktopConfig(root) {
  if (IS_SMOKE_TEST) {
    return { sitePort: SITE_PORT, yummyAnimeToken: process.env.YUMMYANIME_TOKEN || "smoke-test" };
  }
  const configFile = getConfigFile(root);
  const existing = await readConfig(configFile);
  if (existing?.yummyAnimeToken) return existing;

  return new Promise((resolve, reject) => {
    const setupWindow = new BrowserWindow({
      width: 620,
      height: 610,
      resizable: false,
      autoHideMenuBar: true,
      backgroundColor: "#0b0911",
      webPreferences: {
        preload: path.join(root, "desktop", "setup-preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    setupWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    let completed = false;
    const channel = "animesoul:save-launch-config";
    ipcMain.handle(channel, async (_event, input) => {
      const portResult = await validatePort(Number(input?.sitePort));
      if (!portResult.ok) return portResult;
      const tokenResult = await validateYummyToken(input?.yummyAnimeToken);
      if (!tokenResult.ok) return tokenResult;
      const config = await saveConfig(configFile, input);
      completed = true;
      ipcMain.removeHandler(channel);
      setupWindow.close();
      resolve(config);
      return { ok: true };
    });
    setupWindow.on("closed", () => {
      ipcMain.removeHandler(channel);
      if (!completed) reject(new Error("Первоначальная настройка отменена."));
    });
    void setupWindow.loadFile(path.join(root, "desktop", "setup.html"), {
      query: { configFile, defaultPort: "3001" },
    });
  });
}

async function chooseLaunchMode(root, preferredMode = "desktop") {
  if (IS_SMOKE_TEST) return preferredMode === "browser" ? "browser" : "desktop";

  return new Promise((resolve, reject) => {
    launcherWindow = new BrowserWindow({
      width: 650,
      height: 620,
      resizable: false,
      autoHideMenuBar: true,
      backgroundColor: "#0b0911",
      icon: path.join(root, "public", "og.png"),
      webPreferences: {
        preload: path.join(root, "desktop", "launcher-preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    let completed = false;
    const channel = "animesoul:choose-launch-mode";
    const readChannel = "animesoul:get-launch-config";
    const saveChannel = "animesoul:update-launch-config";
    const removeHandlers = () => {
      ipcMain.removeHandler(channel);
      ipcMain.removeHandler(readChannel);
      ipcMain.removeHandler(saveChannel);
    };
    ipcMain.handle(readChannel, async () => {
      const config = await readConfig(getConfigFile(root));
      return {
        ok: true,
        config: {
          sitePort: config?.sitePort ?? 3001,
          yummyAnimeToken: config?.yummyAnimeToken ?? "",
        },
      };
    });
    ipcMain.handle(saveChannel, async (_event, input) => {
      const sitePort = Number(input?.sitePort);
      if (!Number.isInteger(sitePort) || sitePort < 1024 || sitePort > 65534) {
        return { ok: false, error: "Порт должен быть целым числом от 1024 до 65534." };
      }
      if (!siteServer) {
        const portResult = await validatePort(sitePort);
        if (!portResult.ok) return portResult;
      }
      const tokenResult = await validateYummyToken(input?.yummyAnimeToken);
      if (!tokenResult.ok) return tokenResult;
      const configFile = getConfigFile(root);
      const previous = await readConfig(configFile);
      const config = await saveConfig(configFile, {
        ...previous,
        sitePort,
        yummyAnimeToken: String(input?.yummyAnimeToken ?? "").trim(),
        launchMode: previous?.launchMode ?? preferredMode,
      });
      const restartRequired = Boolean(siteServer)
        && (config.sitePort !== SITE_PORT || config.yummyAnimeToken !== process.env.YUMMYANIME_TOKEN);
      return { ok: true, restartRequired };
    });
    ipcMain.handle(channel, (_event, requestedMode) => {
      const selectedMode = requestedMode === "browser"
        ? "browser"
        : requestedMode === "desktop"
          ? "desktop"
          : null;
      if (!selectedMode) return { ok: false, error: "Выбери способ запуска AnimeSoul." };

      completed = true;
      removeHandlers();
      const currentWindow = launcherWindow;
      launcherWindow = undefined;
      currentWindow?.close();
      resolve(selectedMode);
      return { ok: true };
    });

    launcherWindow.on("closed", () => {
      launcherWindow = undefined;
      removeHandlers();
      if (!completed) reject(new Error("Запуск AnimeSoul отменён."));
    });
    void launcherWindow.loadFile(path.join(root, "desktop", "launcher.html"), {
      query: { preferredMode: preferredMode === "browser" ? "browser" : "desktop" },
    });
  });
}

async function waitForUrl(url, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error(`Service unavailable: ${url}`);
}

async function prepareDataDirectory(root) {
  const sharedCandidates = [
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR, "..", "data")
      : null,
    path.join(app.getPath("documents"), "AnimeSoul", "data"),
    path.resolve(path.dirname(process.execPath), "..", "..", "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(root, "data"),
  ].filter(Boolean);
  for (const candidate of [...new Set(sharedCandidates)]) {
    try {
      await access(path.join(candidate, "animesoul-storage.json"));
      return candidate;
    } catch {}
  }

  const dataDir = path.join(app.getPath("userData"), "data");
  const destination = path.join(dataDir, "animesoul-storage.json");
  const legacyFile = path.join(root, "data", "animesoul-storage.json");
  await mkdir(dataDir, { recursive: true });
  try {
    await copyFile(legacyFile, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EEXIST") throw error;
  }
  return dataDir;
}

async function loadZoom() {
  zoomFile = path.join(app.getPath("userData"), "desktop-preferences.json");
  try {
    const preferences = JSON.parse(await readFile(zoomFile, "utf8"));
    const value = Number(preferences.zoomFactor);
    if (Number.isFinite(value)) zoomFactor = Math.min(2, Math.max(0.5, value));
  } catch {}
}

function setZoom(window, value) {
  zoomFactor = Math.round(Math.min(2, Math.max(0.5, value)) * 10) / 10;
  window.webContents.setZoomFactor(zoomFactor);
  if (zoomFile) void writeFile(zoomFile, JSON.stringify({ zoomFactor }, null, 2), "utf8");
}

function startStorage(root, dataDir) {
  const script = path.join(root, "local-storage-server.mjs");
  storageProcess = spawn(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      ANIMESOUL_DATA_DIR: dataDir,
      ANIMESOUL_STORAGE_PORT: String(STORAGE_PORT),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: "#09080d",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(app.getAppPath(), "public", "og.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.once("did-finish-load", () => setZoom(mainWindow, zoomFactor));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const modifier = input.control || input.meta;
    if (modifier && (input.key === "+" || input.key === "=")) {
      event.preventDefault();
      setZoom(mainWindow, zoomFactor + 0.1);
    } else if (modifier && input.key === "-") {
      event.preventDefault();
      setZoom(mainWindow, zoomFactor - 0.1);
    } else if (modifier && input.key === "0") {
      event.preventDefault();
      setZoom(mainWindow, 1);
    } else if (input.key === "F11") {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });
  mainWindow.webContents.on("zoom-changed", (event, direction) => {
    event.preventDefault();
    setZoom(mainWindow, zoomFactor + (direction === "in" ? 0.1 : -0.1));
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(SITE_URL)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  void mainWindow.loadURL(SITE_URL);
}

async function rememberLaunchMode(root, selectedMode) {
  if (IS_SMOKE_TEST) return;
  const configFile = getConfigFile(root);
  const config = await readConfig(configFile);
  if (config?.yummyAnimeToken && config.launchMode !== selectedMode) {
    await saveConfig(configFile, { ...config, launchMode: selectedMode });
  }
}

function openLaunchTarget(selectedMode) {
  launchMode = selectedMode;
  if (selectedMode === "browser") {
    void shell.openExternal(SITE_URL);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  createWindow();
}

async function runPlayerSmokeTest() {
  const marker = path.join(app.getPath("temp"), "animesoul-player-smoke-ok.txt");
  const screenshot = path.join(app.getPath("temp"), "animesoul-player-smoke.png");
  await unlink(marker).catch(() => {});
  const animeId = process.argv.find((value) => value.startsWith("--player-anime="))?.split("=")[1] ?? "10661";
  const dubbing = process.argv.find((value) => value.startsWith("--player-dub="))?.slice("--player-dub=".length);
  const payload = await (await fetch(`${SITE_URL}api/yummy?mode=videos&id=${encodeURIComponent(animeId)}`)).json();
  const video = (payload.videos ?? []).find((item) => /kodik/i.test(item.data?.player) && (!dubbing || item.data?.dubbing === dubbing));
  if (!video?.iframe_url) throw new Error("Kodik test video was not returned");
  const testWindow = new BrowserWindow({
    width: 1000,
    height: 650,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await testWindow.loadURL(`${SITE_URL}__desktop_player_test?src=${encodeURIComponent(video.iframe_url)}`);
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const image = await testWindow.webContents.capturePage();
  await writeFile(screenshot, image.toPNG());
  const bitmap = image.toBitmap();
  let white = 0;
  let samples = 0;
  for (let index = 0; index < bitmap.length; index += 400) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    if (red > 245 && green > 245 && blue > 245) white += 1;
    samples += 1;
  }
  testWindow.destroy();
  if (white / samples > 0.9) throw new Error("External player rendered as a blank white frame");
  await writeFile(marker, new Date().toISOString(), "utf8");
  console.log("AnimeSoul external player smoke test passed");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (launcherWindow) {
      if (launcherWindow.isMinimized()) launcherWindow.restore();
      launcherWindow.focus();
      return;
    }
    const root = app.getAppPath();
    void chooseLaunchMode(root, launchMode)
      .then(async selectedMode => {
        await rememberLaunchMode(root, selectedMode);
        openLaunchTarget(selectedMode);
      })
      .catch(() => {});
  });

  app.whenReady().then(async () => {
    const root = app.getAppPath();
    try {
      const chromeVersion = process.versions.chrome;
      session.defaultSession.setUserAgent(
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
      );
      let launchConfig = await ensureDesktopConfig(root);
      launchMode = await chooseLaunchMode(root, launchConfig.launchMode);
      if (!IS_SMOKE_TEST) {
        await rememberLaunchMode(root, launchMode);
        launchConfig = await readConfig(getConfigFile(root)) ?? launchConfig;
      }
      if (!IS_SMOKE_TEST) {
        const portResult = await validatePort(launchConfig.sitePort);
        if (!portResult.ok) throw new Error(`${portResult.error}\n\nИзмени порт в ${getConfigFile(root)}`);
      }
      SITE_PORT = launchConfig.sitePort;
      STORAGE_PORT = SITE_PORT + 1;
      SITE_URL = `http://localhost:${SITE_PORT}/`;
      process.env.YUMMYANIME_TOKEN = launchConfig.yummyAnimeToken;
      process.env.ANIMESOUL_SITE_PORT = String(SITE_PORT);
      process.env.ANIMESOUL_STORAGE_PORT = String(STORAGE_PORT);
      await loadZoom();
      const dataDir = await prepareDataDirectory(root);
      startStorage(root, dataDir);
      await waitForUrl(`http://127.0.0.1:${STORAGE_PORT}/health`);
      siteServer = await startSiteServer({ root, port: SITE_PORT, testMode: IS_SMOKE_TEST });
      if (process.argv.includes("--player-smoke-test")) {
        await runPlayerSmokeTest();
        app.quit();
        return;
      }
      if (process.argv.includes("--smoke-test")) {
        const response = await waitForUrl(SITE_URL);
        const html = await response.text();
        if (!html.includes("AnimeSoul")) throw new Error("AnimeSoul HTML was not rendered");
        const assets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
          .map((match) => match[1])
          .filter((url) => url.includes("/assets/"));
        if (!assets.some((url) => url.endsWith(".css"))) throw new Error("AnimeSoul CSS was not linked");
        for (const asset of assets) {
          const assetResponse = await fetch(new URL(asset, SITE_URL));
          if (!assetResponse.ok) throw new Error(`AnimeSoul asset failed: ${asset}`);
        }
        console.log("AnimeSoul desktop smoke test passed");
        app.quit();
        return;
      }
      openLaunchTarget(launchMode);
      isStarting = false;
    } catch (error) {
      isStarting = false;
      console.error("[AnimeSoul desktop]", error);
      dialog.showErrorBox(
        "AnimeSoul",
        `Не удалось запустить приложение.\n\n${error instanceof Error ? error.message : String(error)}`,
      );
      app.quit();
    }
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length !== 0 || !siteServer) return;
  if (launchMode === "browser") void shell.openExternal(SITE_URL);
  else createWindow();
});

app.on("window-all-closed", () => {
  if (isStarting) return;
  if (launchMode === "browser" && siteServer) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  siteServer?.close();
  storageProcess?.kill();
});
