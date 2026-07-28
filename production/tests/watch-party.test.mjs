import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const port = 39_000 + (process.pid % 900);
const origin = `http://127.0.0.1:${port}`;

async function request(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function waitUntilReady(server) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Storage server exited with code ${server.exitCode}`);
    try {
      const result = await request("/health");
      if (result.status === 200) return;
    } catch {
      // The server is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Storage server did not become ready");
}

test("watch party respects room authority, free mode, and host transfer", async (context) => {
  const server = spawn(process.execPath, ["local-storage-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ANIMESOUL_STORAGE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => server.kill());
  await waitUntilReady(server);

  const hostPlayback = { animeId: 10, season: 1, episode: 1, time: 12, playing: true };
  const guestPlayback = { animeId: 10, season: 1, episode: 2, time: 3, playing: true };
  const ignoredPlayback = { animeId: 10, season: 1, episode: 3, time: 9, playing: false };

  const created = await request("/watch-party/create", {
    name: "Host",
    mode: "follow",
    roomMode: "host",
  });
  assert.equal(created.status, 200);
  const { roomId, token: hostToken } = created.payload;

  const joined = await request("/watch-party/join", {
    roomId,
    name: "Guest",
    mode: "follow",
  });
  assert.equal(joined.status, 200);
  const guestToken = joined.payload.token;

  await request("/watch-party/update", {
    roomId,
    token: hostToken,
    mode: "follow",
    roomMode: "host",
    playback: hostPlayback,
    control: true,
  });
  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    playback: guestPlayback,
    control: true,
  });
  let state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.roomMode, "host");
  assert.deepEqual(
    { ...state.playback, sentAt: undefined },
    { ...hostPlayback, sentAt: undefined },
    "a guest cannot control a host-controlled room",
  );

  await request("/watch-party/update", {
    roomId,
    token: hostToken,
    mode: "follow",
    roomMode: "shared",
    playback: hostPlayback,
  });
  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    playback: guestPlayback,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.roomMode, "shared");
  assert.equal(state.playback.episode, 2);
  assert.equal(state.lastControllerId, guestToken);

  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "free",
    playback: ignoredPlayback,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.playback.episode, 2, "free mode never changes synchronized playback");
  assert.equal(
    state.participants.find((participant) => participant.id === guestToken)?.mode,
    "free",
  );

  const transferred = await request("/watch-party/transfer-host", {
    roomId,
    token: hostToken,
    participantId: guestToken,
  });
  assert.equal(transferred.status, 200);
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(
    state.participants.find((participant) => participant.id === guestToken)?.role,
    "host",
  );
  assert.equal(
    state.participants.find((participant) => participant.id === hostToken)?.role,
    "guest",
  );
});
