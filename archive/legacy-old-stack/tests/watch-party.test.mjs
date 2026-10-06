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
  const health = await request("/health");
  assert.equal(health.payload.watchPartyProtocol, 2);

  const playback = (episode, position, playing) => ({
    animeId: 10,
    season: 1,
    episode: String(episode),
    dub: "AniLibria",
    player: "Kodik",
    position,
    duration: 1440,
    playing,
    updatedAt: Date.now(),
  });
  const hostPlayback = playback(1, 12, true);
  const guestPlayback = playback(2, 3, true);
  const ignoredPlayback = playback(3, 9, false);

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
  assert.equal(state.playback.episode, "2");
  assert.equal(state.lastControllerId, guestToken);

  const guestPause = { ...guestPlayback, position: 18, playing: false };
  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    playback: guestPause,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.playback.playing, false, "desktop guest can pause a web host in shared mode");
  assert.equal(state.lastControllerId, guestToken);

  const guestPlay = { ...guestPause, position: 18, playing: true };
  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    playback: guestPlay,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.playback.playing, true, "desktop guest can resume a web host in shared mode");

  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "free",
    playback: ignoredPlayback,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.playback.episode, "2", "free mode never changes synchronized playback");
  assert.equal(
    state.participants.find((participant) => participant.id === guestToken)?.mode,
    "free",
  );

  const staleTransfer = await request("/watch-party/transfer-host", {
    roomId,
    token: hostToken,
    participantId: "offline-participant",
  });
  assert.equal(staleTransfer.status, 404);
  assert.equal(staleTransfer.payload.code, "PARTICIPANT_NOT_FOUND");

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

  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    roomMode: "host",
    playback: guestPlay,
    control: true,
  });
  const oldHostAttempt = playback(4, 33, false);
  await request("/watch-party/update", {
    roomId,
    token: hostToken,
    mode: "follow",
    roomMode: "shared",
    playback: oldHostAttempt,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.roomMode, "host", "an old host cannot change the room rule");
  assert.equal(state.playback.episode, "2", "an old host cannot control a host-only room");

  const newHostPlayback = playback(5, 44, false);
  await request("/watch-party/update", {
    roomId,
    token: guestToken,
    mode: "follow",
    roomMode: "host",
    playback: newHostPlayback,
    control: true,
  });
  state = (await request(`/watch-party/state?room=${roomId}`)).payload;
  assert.equal(state.playback.episode, "5");
  assert.equal(state.playback.playing, false);
});
