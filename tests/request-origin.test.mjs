import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedRequestOrigin } from "../packages/contracts/dist/request-origin.js";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { csrfToken } from "../apps/api/dist/auth/security.js";

test("local aliases use only the configured scheme and port in both directions", () => {
  const hosts = ["localhost", "127.0.0.1", "[::1]"];
  for (const port of [8021, 8022])
    for (const configured of hosts)
      for (const actual of hosts)
        assert.equal(
          isTrustedRequestOrigin(`http://${actual}:${port}`, `http://${configured}:${port}/`),
          true,
        );
  for (const origin of [
    "http://127.0.0.1:18031",
    "http://localhost:8022",
    "https://127.0.0.1:8021",
    "http://127.0.0.2:8021",
    "http://localhost.attacker.invalid:8021",
  ])
    assert.equal(isTrustedRequestOrigin(origin, "http://localhost:8021"), false, origin);
});

test("public site and admin origins remain exact and isolated from local origins", () => {
  const site = "https://animesoul.example";
  assert.equal(isTrustedRequestOrigin(site, site + "/account"), true);
  for (const origin of [
    "https://admin.animesoul.example",
    "http://animesoul.example",
    "https://animesoul.example:8021",
    "https://attacker.invalid",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
  ])
    assert.equal(isTrustedRequestOrigin(origin, site), false, origin);
});

test("origin headers reject absent, multiple, credential-bearing and non-origin values", () => {
  const site = "http://localhost:8021";
  for (const origin of [
    undefined,
    null,
    "null",
    "",
    [site],
    site + " https://attacker.invalid",
    site + "/",
    site + "/account",
    site + "?x=1",
    site + "#account",
    "http://user:password@localhost:8021",
    " http://localhost:8021",
    "http://127.1:8021",
    "file:///account",
  ])
    assert.equal(isTrustedRequestOrigin(origin, site), false, String(origin));
  assert.equal(isTrustedRequestOrigin(site, "invalid-config"), false);
  assert.equal(isTrustedRequestOrigin("ftp://localhost", "ftp://localhost"), false);
});

const config = { SITE_URL: "http://localhost:8021", ADMIN_URL: "http://localhost:8022" };
const request = (origin = "http://127.0.0.1:8021", extra = {}) => ({
  ip: "127.0.0.1",
  headers: { origin, "x-animesoul-request": "1", ...extra },
});

test("API accepts local aliases while requiring the custom header and correct audience port", () => {
  const auth = new AuthService(config);
  assert.doesNotThrow(() => auth.origin(request()));
  assert.doesNotThrow(() => auth.origin(request("http://127.0.0.1:8022"), "admin"));
  for (const input of [
    request("https://attacker.invalid"),
    request("http://127.0.0.1:18031"),
    request("http://127.0.0.1:8022"),
    request(undefined, { "x-animesoul-request": undefined }),
    request(undefined, { "x-animesoul-request": ["1"] }),
  ])
    assert.throws(() => auth.origin(input), /Invalid request origin/);
  assert.throws(() => auth.origin(request(), "admin"), /Invalid request origin/);
});

test("local origin aliases do not bypass session CSRF validation", async () => {
  const auth = new AuthService(config);
  const token = "a".repeat(43);
  const session = { id: "test-session" };
  let reads = 0;
  auth.requireSession = async () => {
    reads++;
    return session;
  };
  const extra = {
    cookie: "animesoul_web_session=" + token,
    "x-csrf-token": csrfToken(token),
  };
  assert.equal(await auth.writeSession(request(undefined, extra)), session);
  await assert.rejects(
    auth.writeSession(request(undefined, { ...extra, "x-csrf-token": "wrong" })),
    /Invalid CSRF token/,
  );
  await assert.rejects(
    auth.writeSession(request(undefined, { ...extra, "x-csrf-token": undefined })),
    /Invalid CSRF token/,
  );
  const before = reads;
  await assert.rejects(
    auth.writeSession(request("https://attacker.invalid", extra)),
    /Invalid request origin/,
  );
  assert.equal(reads, before);
});
