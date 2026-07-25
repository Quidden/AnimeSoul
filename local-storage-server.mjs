import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const STORAGE_FILE = path.join(DATA_DIR, "animesoul-storage.json");
const TEMP_FILE = path.join(DATA_DIR, "animesoul-storage.tmp.json");
const PORT = Number(process.env.ANIMESOUL_STORAGE_PORT || 3002);
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function reply(response, status, payload) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 25 * 1024 * 1024) throw new Error("Payload too large");
  }
  return JSON.parse(raw || "{}");
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return reply(response, 204, {});
  if (request.url === "/health" && request.method === "GET") return reply(response, 200, { ok: true });
  if (request.url !== "/storage") return reply(response, 404, { error: "Not found" });

  try {
    if (request.method === "GET") {
      try {
        return reply(response, 200, JSON.parse(await readFile(STORAGE_FILE, "utf8")));
      } catch (error) {
        if (error?.code === "ENOENT") return reply(response, 404, { exists: false });
        throw error;
      }
    }
    if (request.method === "PUT") {
      const document = await readBody(request);
      if (!document || typeof document !== "object") return reply(response, 400, { error: "Некорректные данные" });
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(TEMP_FILE, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      await rename(TEMP_FILE, STORAGE_FILE);
      return reply(response, 200, { saved: true, path: "data/animesoul-storage.json" });
    }
    return reply(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("[AnimeSoul storage]", error);
    return reply(response, 500, { error: "Не удалось обработать локальные данные" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AnimeSoul storage: http://127.0.0.1:${PORT}`);
  console.log(`Data file: ${STORAGE_FILE}`);
});
