import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { InternalProxyService } from "../dist/auth/internal-proxy.service.js";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";

const secret = "fixture-proxy-secret-".repeat(4);
const peer = "172.20.0.5";
const client = "203.0.113.10";
const config = (extra = {}) =>
  readConfig({
    NODE_ENV: "test",
    INTERNAL_PROXY_SECRET: secret,
    INTERNAL_PROXY_TRUSTED_IPS: peer,
    ...extra,
  });
const headers = (ip = client, extra = {}) => ({
  "x-animesoul-client-ip": ip,
  "x-animesoul-proxy-secret": secret,
  ...extra,
});
const request = (ip = peer, value = headers()) => ({ ip, headers: value });

test("proxy identity is opt-in and requires an explicit source allowlist", () => {
  assert.throws(() => readConfig({ INTERNAL_PROXY_SECRET: secret }), /explicitly trusted/);
  for (const value of ["short", "a".repeat(32) + "\n", "a b".repeat(20)])
    assert.throws(() => config({ INTERNAL_PROXY_SECRET: value }));
  for (const value of ["172.20.0.0/16", "web", "2001:db8::1%eth0"])
    assert.throws(() => config({ INTERNAL_PROXY_TRUSTED_IPS: value }));
  assert.equal(config({ INTERNAL_PROXY_SECRET: "" }).INTERNAL_PROXY_SECRET, "");
});

test("a forged client IP without the secret or from another socket peer is ignored", async () => {
  const proxy = new InternalProxyService(config());
  for (const supplied of [
    { "x-animesoul-client-ip": client },
    headers(client, { "x-animesoul-proxy-secret": "wrong-secret-".repeat(4) }),
    headers(client, { "x-animesoul-proxy-secret": [secret, secret] }),
    headers(client, { "x-animesoul-proxy-secret": secret + ", " + secret }),
    { "x-forwarded-for": client, forwarded: "for=" + client },
  ])
    assert.equal(await proxy.clientIp(request(peer, supplied)), peer);
  const foreign = "172.20.0.6";
  assert.equal(
    await proxy.clientIp(
      request(foreign, headers(client, { "x-forwarded-for": peer, "x-forwarded-host": "web" })),
    ),
    foreign,
  );
  assert.equal(
    await new InternalProxyService(config({ INTERNAL_PROXY_SECRET: "" })).clientIp(request()),
    peer,
  );
});

test("accepted visitor IPs are literals; mapped peers are canonical and neighboring IPv6 peers are not trusted", async () => {
  const proxy = new InternalProxyService(config());
  const req = request();
  assert.equal(await proxy.clientIp(req), client);
  assert.equal(req.ip, peer);
  assert.equal(
    await proxy.clientIp(request("::ffff:" + peer, headers("::ffff:" + client))),
    client,
  );
  for (const value of [
    "203.0.113.1, 203.0.113.2",
    "203.0.113.1:443",
    "[2001:db8::1]",
    "2001:db8::1%eth0",
    "203.0.113.0/24",
    "https://example.test",
    [client, client],
  ])
    assert.equal(await proxy.clientIp(request(peer, headers(value))), peer);
  const ipv6 = new InternalProxyService(config({ INTERNAL_PROXY_TRUSTED_IPS: "2001:db8::5" }));
  assert.equal(await ipv6.clientIp(request("2001:0db8:0:0:0:0:0:5")), client);
  assert.equal(await ipv6.clientIp(request("2001:db8::6")), "2001:db8::6");
});

test("only current DNS addresses of the configured web service are authorized; errors do not reuse old peers", async () => {
  let addresses = [peer],
    calls = 0;
  const proxy = new InternalProxyService(
    config({ INTERNAL_PROXY_TRUSTED_IPS: "", INTERNAL_PROXY_TRUSTED_HOSTS: "web" }),
    async (host) => {
      assert.equal(host, "web");
      calls++;
      if (!addresses) throw new Error("DNS unavailable");
      return addresses.map((address) => ({ address }));
    },
  );
  assert.equal(await proxy.clientIp(request()), client);
  const afterRestart = "172.20.0.8";
  addresses = [afterRestart];
  assert.equal(await proxy.clientIp(request()), peer);
  assert.equal(await proxy.clientIp(request(afterRestart)), client);
  addresses = null;
  assert.equal(await proxy.clientIp(request(afterRestart)), afterRestart);
  assert.equal(calls, 4);
  await proxy.clientIp(request(peer, { "x-animesoul-client-ip": client }));
  assert.equal(calls, 4);
});

test("concurrent proxy checks share one DNS lookup and DNS timeout falls back to the socket IP", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve,
    calls = 0;
  const proxy = new InternalProxyService(
    config({ INTERNAL_PROXY_TRUSTED_IPS: "", INTERNAL_PROXY_TRUSTED_HOSTS: "web" }),
    () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  );
  const first = proxy.clientIp(request());
  const second = proxy.clientIp(request(peer, headers("198.51.100.20")));
  resolve([{ address: peer }]);
  assert.deepEqual(await Promise.all([first, second]), [client, "198.51.100.20"]);
  assert.equal(calls, 1);
  const unavailable = proxy.clientIp(request());
  context.mock.timers.tick(1001);
  assert.equal(await unavailable, peer);
});

async function fixture(extra = {}) {
  const requireApi = createRequire(new URL("../package.json", import.meta.url));
  const { default: sharp } = await import(pathToFileURL(requireApi.resolve("sharp")));
  const payload = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();
  const app = await createApplication(config(extra), fetch, {
    frameFetch: async (url) =>
      Response.json(url.endsWith("/me") ? { quota: 100, quotaUsed: 0 } : { result: [] }),
  });
  const server = app.getHttpAdapter().getInstance();
  const send = (supplied, ip = peer) =>
    server.inject({
      method: "POST",
      url: "/api/search/frame",
      remoteAddress: ip,
      payload,
      headers: {
        origin: "http://localhost:8021",
        "x-animesoul-request": "1",
        "content-type": "application/octet-stream",
        ...supplied,
      },
    });
  const quota = (supplied, path = "quota") =>
    server.inject({ url: "/api/search/frame/" + path, remoteAddress: peer, headers: supplied });
  return { app, server, send, quota };
}

test("HTTP spoofing cannot rotate the minute budget without a secret or through an untrusted peer", async () => {
  const { app, server, send, quota } = await fixture();
  try {
    for (let index = 0; index < 5; index++)
      assert.equal(
        (await send({ "x-animesoul-client-ip": "203.0.113." + (index + 1) })).statusCode,
        200,
      );
    assert.equal((await send({ "x-animesoul-client-ip": "198.51.100.99" })).statusCode, 429);
    assert.equal(
      (await quota({ "x-animesoul-client-ip": "198.51.100.99" })).json().personal.used,
      5,
    );
    for (let index = 0; index < 5; index++)
      assert.equal(
        (await send(headers("198.51.100." + (index + 1)), "172.20.0.6")).statusCode,
        200,
      );
    assert.equal((await send(headers("198.51.100.99"), "172.20.0.6")).statusCode, 429);
    assert.equal((await send(headers())).statusCode, 200);
    assert.equal((await quota(headers())).json().personal.remaining, 9);
    const before = await server.inject({
      url: "/api/auth/options",
      remoteAddress: peer,
      headers: headers(),
    });
    const after = await server.inject({
      url: "/api/auth/options",
      remoteAddress: peer,
      headers: headers("198.51.100.99"),
    });
    assert.equal(
      Number(after.headers["x-ratelimit-remaining"]),
      Number(before.headers["x-ratelimit-remaining"]) - 1,
    );
  } finally {
    await app.close();
  }
});

test("verified proxy visitors have separate daily quotas consistently on search, quota and limit", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const { app, send, quota } = await fixture();
  try {
    for (let index = 0; index < 10; index++) {
      context.mock.timers.tick(61000);
      const response = await send(headers());
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().quota.personal.remaining, 9 - index);
    }
    context.mock.timers.tick(61000);
    const limited = await send(headers());
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().limitScope, "personal");
    assert.equal(Number(limited.headers["retry-after"]), limited.json().retryAfter);
    const mapped = (await quota(headers("::ffff:" + client), "limit")).json();
    assert.equal(mapped.personal.remaining, 0);
    const other = (await quota(headers("198.51.100.20"))).json();
    assert.equal(other.personal.remaining, 10);
    assert.equal(other.global.remaining, 90);
    assert.equal((await send(headers("198.51.100.20"))).statusCode, 200);
  } finally {
    await app.close();
  }
});
