import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SITE_PORT = 3001;
export const CONFIG_NAME = "animesoul.config.json";

export function normalizeConfig(input = {}) {
  const sitePort = Number(input.sitePort);
  return {
    _comment: "Настройки запуска AnimeSoul. Файл можно изменить вручную при закрытом приложении. sitePort — порт сайта, storagePort назначается следующим автоматически, yummyAnimeToken — публичный ключ приложения YummyAnime.",
    sitePort: Number.isInteger(sitePort) && sitePort >= 1024 && sitePort <= 65534 ? sitePort : DEFAULT_SITE_PORT,
    yummyAnimeToken: typeof input.yummyAnimeToken === "string" ? input.yummyAnimeToken.trim() : "",
    launchMode: input.launchMode === "browser" ? "browser" : "desktop",
  };
}

export async function readConfig(file) {
  try {
    return normalizeConfig(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

export async function saveConfig(file, input) {
  const config = normalizeConfig(input);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function validatePort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1024 || value > 65534) {
    return { ok: false, error: "Порт должен быть целым числом от 1024 до 65534." };
  }
  for (const candidate of [value, value + 1]) {
    const available = await new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (!available) return { ok: false, error: `Порт ${candidate} уже занят. Закрой использующую его программу или выбери другой порт сайта.` };
  }
  return { ok: true };
}

export async function validateYummyToken(token) {
  const value = String(token ?? "").trim();
  if (!value) return { ok: false, error: "Ключ YummyAnime не может быть пустым." };
  try {
    const response = await fetch("https://api.yani.tv/anime?limit=1&offset=0", {
      headers: { "X-Application": value, Lang: "ru", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, error: "YummyAnime отклонил ключ. Проверь его и введи заново." };
    if (!response.ok) return { ok: false, error: `YummyAnime вернул ошибку ${response.status}. Попробуй ещё раз позже.` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось связаться с YummyAnime. Проверь интернет и повтори попытку." };
  }
}
