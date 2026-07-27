import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANIMESOUL_DATA_DIR
  ? path.resolve(process.env.ANIMESOUL_DATA_DIR)
  : path.join(ROOT, "data");
const STORAGE_FILE = path.join(DATA_DIR, "animesoul-storage.json");
const TEMP_FILE = path.join(DATA_DIR, "animesoul-storage.tmp.json");
const PORT = Number(process.env.ANIMESOUL_STORAGE_PORT || 3002);
const rooms = new Map();
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
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
  if (request.url?.startsWith("/watch-party")) {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const roomId = url.searchParams.get("room")?.toUpperCase();
      if (request.method === "POST" && url.pathname === "/watch-party/create") {
        const body = await readBody(request), id = Math.random().toString(36).slice(2, 8).toUpperCase(), token = crypto.randomUUID();
        rooms.set(id, { id, hostToken: token, createdAt: Date.now(), updatedAt: Date.now(), playback: null, actionSeq: 0, participants: new Map([[token, { id: token, name: String(body.name || "Хост").slice(0, 32), role: "host", mode: "follow", updatedAt: Date.now() }]]) });
        return reply(response, 200, { roomId: id, token, role: "host" });
      }
      if (request.method === "POST" && url.pathname === "/watch-party/join") {
        const body = await readBody(request), room = rooms.get(String(body.roomId || "").toUpperCase());
        if (!room) return reply(response, 404, { error: "Комната не найдена" });
        const token = crypto.randomUUID();
        room.participants.set(token, { id: token, name: String(body.name || "Участник").slice(0, 32), role: "guest", mode: body.mode === "free" ? "free" : "follow", updatedAt: Date.now() });
        room.updatedAt = Date.now();
        return reply(response, 200, { roomId: room.id, token, role: "guest" });
      }
      if (request.method === "POST" && url.pathname === "/watch-party/update") {
        const body = await readBody(request), room = rooms.get(String(body.roomId || "").toUpperCase()), participant = room?.participants.get(body.token);
        if (!room || !participant) return reply(response, 404, { error: "Подключение к комнате потеряно" });
        Object.assign(participant, { name: String(body.name || participant.name).slice(0, 32), mode: body.mode === "free" ? "free" : "follow", playback: body.playback ?? participant.playback, buffering: Boolean(body.buffering), updatedAt: Date.now() });
        if (body.token === room.hostToken && body.playback) {
          room.playback = { ...body.playback, sentAt: Date.now() };
          if (body.action) room.actionSeq += 1;
          room.lastAction = body.action ? { ...body.action, seq: room.actionSeq } : room.lastAction;
        }
        room.updatedAt = Date.now();
        return reply(response, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/watch-party/state") {
        const room = rooms.get(roomId);
        if (!room) return reply(response, 404, { error: "Комната не найдена" });
        const now = Date.now();
        for (const [token, participant] of room.participants) if (now - participant.updatedAt > 15000 && token !== room.hostToken) room.participants.delete(token);
        return reply(response, 200, { roomId: room.id, playback: room.playback, lastAction: room.lastAction, participants: [...room.participants.values()].map(({ id, name, role, mode, playback, buffering, updatedAt }) => ({ id, name, role, mode, playback, buffering, online: now - updatedAt < 6000 })) });
      }
      if (request.method === "POST" && url.pathname === "/watch-party/leave") {
        const body = await readBody(request), room = rooms.get(String(body.roomId || "").toUpperCase());
        if (room) body.token === room.hostToken ? rooms.delete(room.id) : room.participants.delete(body.token);
        return reply(response, 200, { ok: true });
      }
      return reply(response, 404, { error: "Watch party endpoint not found" });
    } catch (error) {
      console.error("[AnimeSoul watch party]", error);
      return reply(response, 500, { error: "Ошибка совместного просмотра" });
    }
  }
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AnimeSoul storage and watch party: http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${STORAGE_FILE}`);
});
