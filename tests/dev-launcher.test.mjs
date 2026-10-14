import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspectDevelopment } from "../scripts/workspace/dev-status.mjs";
import { openDevelopmentSite } from "../scripts/workspace/open-development-site.mjs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { clearTimeout } from "node:timers";

async function fixture(t, changes = {}) {
  const requests = [0, 0, 0];
  const responses = [
    { type: "application/json", body: JSON.stringify({ status: "ok", version: "0.4.0" }) },
    { type: "text/html", body: "<html><head><title>AnimeSoul — мир аниме</title></head></html>" },
    { type: "text/html", body: "<html><head><title>AnimeSoul Admin</title></head></html>" },
  ];
  const servers = await Promise.all(
    responses.map(async (defaults, index) => {
      const response = { ...defaults, ...changes[index] };
      const server = createServer((req, res) => {
        requests[index]++;
        if (response.hang) return;
        res.writeHead(response.status || 200, { "Content-Type": response.type });
        res.end(response.body);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server;
    }),
  );
  const options = {
    apiHost: "127.0.0.1",
    apiPort: servers[0].address().port,
    webPort: servers[1].address().port,
    adminPort: servers[2].address().port,
    timeoutMs: 1000,
  };
  async function close(index) {
    const server = servers[index];
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  t.after(async () => {
    await Promise.all(servers.map((_, index) => close(index)));
  });
  return { options, servers, requests, close };
}

test("development launcher permits startup when every port is free", async (t) => {
  const { options, close } = await fixture(t);
  await Promise.all([0, 1, 2].map(close));
  assert.deepEqual(await inspectDevelopment(options), { state: "available", busy: [] });
});

test("development launcher reuses a healthy AnimeSoul stack without stopping it", async (t) => {
  const { options, requests, servers } = await fixture(t);
  const status = await inspectDevelopment(options);
  assert.equal(status.state, "running");
  assert.deepEqual(
    status.busy.map((service) => service.port),
    [options.apiPort, options.webPort, options.adminPort],
  );
  assert.deepEqual(requests, [1, 1, 1]);
  assert.ok(servers.every((server) => server.listening));
  assert.equal((await fetch(`http://127.0.0.1:${options.webPort}/`)).status, 200);
});

test("development launcher reports a partial occupied stack before launching anything", async (t) => {
  const { options, requests, servers, close } = await fixture(t);
  await close(0);
  await close(2);
  const status = await inspectDevelopment(options);
  assert.equal(status.state, "conflict");
  assert.deepEqual(
    status.busy.map((service) => service.name),
    ["Web"],
  );
  assert.deepEqual(requests, [0, 0, 0]);
  assert.equal(servers[1].listening, true);
});

test("development launcher does not mistake an unrelated website for AnimeSoul", async (t) => {
  const { options, servers } = await fixture(t, {
    1: { body: "<title>Other application</title>" },
  });
  assert.equal((await inspectDevelopment(options)).state, "conflict");
  assert.ok(servers.every((server) => server.listening));
});

test("development launcher rejects failed health checks and redirects", async (t) => {
  for (const response of [{ status: 503 }, { status: 302 }, { body: "not JSON" }]) {
    const { options } = await fixture(t, { 0: response });
    assert.equal((await inspectDevelopment(options)).state, "conflict");
  }
});

test("development launcher bounds checks for an unresponsive occupied port", async (t) => {
  const { options, servers } = await fixture(t, { 0: { hang: true } });
  assert.equal((await inspectDevelopment({ ...options, timeoutMs: 100 })).state, "conflict");
  assert.ok(servers.every((server) => server.listening));
});

test("browser opens once after the complete AnimeSoul stack becomes ready", async (t) => {
  const { options, close, servers } = await fixture(t);
  await close(0);
  const opened = [];
  const opening = openDevelopmentSite({
    options,
    timeoutMs: 2000,
    intervalMs: 10,
    open: async (url) => opened.push(url),
  });
  await delay(30);
  assert.deepEqual(opened, []);
  await new Promise((resolve) => servers[0].listen(options.apiPort, "127.0.0.1", resolve));
  await opening;
  assert.deepEqual(opened, ["http://localhost:8021"]);
});

test("browser does not open another application and readiness waiting is bounded", async (t) => {
  const { options } = await fixture(t, { 1: { body: "<title>Other application</title>" } });
  let opened = false;
  await assert.rejects(
    openDevelopmentSite({
      options,
      timeoutMs: 50,
      intervalMs: 10,
      open: async () => {
        opened = true;
      },
    }),
    /did not become ready/,
  );
  assert.equal(opened, false);
});

test("stopping startup cancels opening the browser", async (t) => {
  const { options, close } = await fixture(t);
  await close(0);
  const controller = new AbortController();
  let opened = false;
  const opening = openDevelopmentSite({
    options,
    signal: controller.signal,
    open: async () => {
      opened = true;
    },
  });
  controller.abort();
  await assert.rejects(opening, { name: "AbortError" });
  assert.equal(opened, false);
});

async function batchFixture(t, status) {
  const root = await mkdtemp(path.join(tmpdir(), "animesoul-launcher-"));
  t.after(async () => {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("animesoul-launcher-")
    )
      throw new Error("Refusing to remove a fixture outside the temporary directory.");
    await rm(root, { recursive: true, force: true });
  });
  const folders = ["scripts/windows", "scripts/workspace", "node_modules", "bin", "unrelated"];
  await Promise.all(folders.map((folder) => mkdir(path.join(root, folder), { recursive: true })));
  const calls = path.join(root, "pnpm-calls.txt"),
    opened = path.join(root, "opened.txt");
  const bat = path.join(root, "scripts/windows/Start AnimeSoul.bat");
  await Promise.all([
    writeFile(
      bat,
      await readFile(new URL("../scripts/windows/Start AnimeSoul Dev.bat", import.meta.url)),
    ),
    writeFile(path.join(root, "node_modules/.modules.yaml"), "fixture"),
    writeFile(
      path.join(root, "scripts/workspace/dev-status.mjs"),
      "process.exitCode = Number(process.env.ANIMESOUL_LAUNCH_TEST_STATUS);",
    ),
    writeFile(
      path.join(root, "scripts/workspace/open-development-site.mjs"),
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.ANIMESOUL_LAUNCH_TEST_OPENED, process.cwd());",
    ),
    writeFile(
      path.join(root, "bin/pnpm.cmd"),
      '@echo off\r\necho %*>>"%ANIMESOUL_LAUNCH_TEST_CALLS%"\r\nexit /b 0\r\n',
    ),
  ]);
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"call "${bat}""`], {
    cwd: path.join(root, "unrelated"),
    env: {
      ...process.env,
      PATH: path.join(root, "bin") + path.delimiter + process.env.PATH,
      ANIMESOUL_LAUNCH_TEST_STATUS: String(status),
      ANIMESOUL_LAUNCH_TEST_CALLS: calls,
      ANIMESOUL_LAUNCH_TEST_OPENED: opened,
    },
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end("\r\n");
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Windows batch fixture did not finish."));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(code, 0, output);
  return { root, calls, opened };
}

test(
  "Windows batch reopens an existing site without setup or another server",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { root, calls, opened } = await batchFixture(t, 10);
    assert.equal(await readFile(opened, "utf8"), root);
    await assert.rejects(readFile(calls), { code: "ENOENT" });
  },
);

test(
  "Windows batch starts from its own root and requests opening after readiness",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { calls } = await batchFixture(t, 0);
    assert.deepEqual((await readFile(calls, "utf8")).trim().split(/\r?\n/), [
      "run setup",
      "run dev --open",
    ]);
  },
);
