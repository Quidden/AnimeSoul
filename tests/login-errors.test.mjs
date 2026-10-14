import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { stripTypeScriptTypes } from "node:module";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { hashPassword } from "../apps/api/dist/auth/security.js";

const password = "abc123";
const passwordHash = await hashPassword(password);
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  passwordHash,
  disabledAt: null,
  googleSubject: null,
  roles: [],
  permissions: [],
};
const input = { email: "login-errors@example.invalid", password };
const reply = { header: () => {} };
const request = (audience = "web") => ({
  ip: "127.0.0.1",
  headers: {
    origin: `http://127.0.0.1:${audience === "web" ? 8021 : 8022}`,
    "x-animesoul-request": "1",
  },
});
function fixture(row) {
  const calls = { reads: 0, attempts: [], audits: [], sessions: [] };
  const auth = new AuthService({
    SITE_URL: "http://localhost:8021",
    ADMIN_URL: "http://localhost:8022",
  });
  Object.defineProperty(auth, "db", {
    value: {
      user: {
        findUnique: async () => {
          calls.reads++;
          return row;
        },
      },
      auditEvent: { create: async (value) => calls.audits.push(value) },
    },
  });
  auth.throttle = async (_request, identity) => calls.attempts.push(identity);
  auth.issueSession = async (...args) => {
    calls.sessions.push(args);
    return { authenticated: true };
  };
  return { auth, calls };
}
function failure(code, message) {
  return (error) => {
    assert.equal(error.getStatus(), 401);
    assert.deepEqual(error.getResponse(), { code, message });
    return true;
  };
}

test("web login distinguishes absent email from a wrong password without creating a session", async () => {
  for (const [row, supplied, code, message] of [
    [null, password, "ACCOUNT_NOT_FOUND", "Аккаунт с такой почтой не найден."],
    [user, "wrong6", "INVALID_PASSWORD", "Неверный пароль."],
  ]) {
    const f = fixture(row);
    await assert.rejects(
      f.auth.login({ ...input, password: supplied }, request(), reply),
      failure(code, message),
    );
    assert.equal(f.calls.reads, 1);
    assert.deepEqual(f.calls.attempts, ["login:" + input.email]);
    assert.deepEqual(f.calls.audits, []);
    assert.deepEqual(f.calls.sessions, []);
  }
});

test("correct six-character credentials still issue a web session and audit the login", async () => {
  const f = fixture(user);
  assert.deepEqual(await f.auth.login(input, request(), reply), { authenticated: true });
  assert.equal(f.calls.sessions.length, 1);
  assert.equal(f.calls.sessions[0][0], user.id);
  assert.equal(f.calls.sessions[0][2], "web");
  assert.deepEqual(f.calls.audits[0].data, {
    actorId: user.id,
    action: "session.login.web",
    objectId: user.id,
  });
});

test("Google-only, missing-password and blocked accounts receive their actual failure reason", async () => {
  for (const [row, code, message] of [
    [
      { ...user, passwordHash: null, googleSubject: "google-id" },
      "GOOGLE_LOGIN_REQUIRED",
      "Для этого аккаунта нужно войти через Google.",
    ],
    [{ ...user, passwordHash: null }, "PASSWORD_NOT_SET", "У этого аккаунта не установлен пароль."],
    [
      { ...user, disabledAt: new Date() },
      "ACCOUNT_DISABLED",
      "Аккаунт заблокирован. Обратитесь к администратору.",
    ],
  ]) {
    const f = fixture(row);
    await assert.rejects(f.auth.login(input, request(), reply), failure(code, message));
    assert.equal(f.calls.sessions.length, 0);
  }
  const f = fixture({ ...user, disabledAt: new Date() });
  await assert.rejects(
    f.auth.login({ ...input, password: "wrong6" }, request(), reply),
    failure("INVALID_PASSWORD", "Неверный пароль."),
  );
});

test("admin login keeps generic credentials errors and does not expose account failure codes", async () => {
  for (const row of [
    null,
    user,
    { ...user, disabledAt: new Date() },
    { ...user, passwordHash: null },
  ]) {
    const f = fixture(row);
    await assert.rejects(f.auth.login(input, request("admin"), reply, "admin"), (error) => {
      assert.equal(error.getStatus(), 401);
      assert.equal(error.getResponse().message, "Invalid credentials.");
      assert.equal(error.getResponse().code, undefined);
      return true;
    });
    assert.equal(f.calls.sessions.length, 0);
  }
});

test("login still rejects foreign origins before looking up the email", async () => {
  const f = fixture(null);
  const incoming = request();
  incoming.headers.origin = "https://attacker.invalid";
  await assert.rejects(f.auth.login(input, incoming, reply), /Invalid request origin/);
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.attempts.length, 0);
});

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/account-client.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
}).replace(
  'from "@animesoul/contracts"',
  "from " + JSON.stringify(new URL("../packages/contracts/dist/index.js", import.meta.url).href),
);
const { accountRequest, AccountRequestError } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
function mockResponses(t) {
  const original = globalThis.fetch;
  let makeResponse;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => makeResponse();
  return (response) => {
    makeResponse = response;
  };
}
const login = () => accountRequest("/api/auth/login", input, "", false);

test("the login form displays fixed messages for each server failure code", async (t) => {
  const respond = mockResponses(t);
  for (const [code, message] of [
    ["ACCOUNT_NOT_FOUND", "Аккаунт с такой почтой не найден."],
    ["INVALID_PASSWORD", "Неверный пароль."],
    ["ACCOUNT_DISABLED", "Аккаунт заблокирован. Обратитесь к администратору."],
    ["GOOGLE_LOGIN_REQUIRED", "Для этого аккаунта нужно войти через Google."],
    ["PASSWORD_NOT_SET", "У этого аккаунта не установлен пароль."],
  ]) {
    respond(() => Response.json({ code, message: "Untrusted server text" }, { status: 401 }));
    await assert.rejects(login(), (error) => {
      assert.ok(error instanceof AccountRequestError);
      assert.equal(error.status, 401);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test("unknown or non-JSON login errors use a safe fallback instead of raw server output", async (t) => {
  const respond = mockResponses(t);
  for (const body of [
    JSON.stringify({ code: "UNKNOWN", message: "PRIVATE_SERVER_DETAIL" }),
    "invalid",
  ]) {
    respond(() => new Response(body, { status: 401 }));
    await assert.rejects(login(), { message: "Не удалось войти. Проверьте почту и пароль." });
  }
});

test("validation, throttling, service failures and expired sessions retain relevant messages", async (t) => {
  const respond = mockResponses(t);
  for (const [status, path, message, headers] of [
    [
      400,
      "/api/auth/login",
      "Проверьте почту и пароль. Пароль должен содержать от 6 до 128 символов.",
      {},
    ],
    [
      429,
      "/api/auth/login",
      "Слишком много запросов. Повторите через 12 сек.",
      { "retry-after": "12" },
    ],
    [503, "/api/auth/login", "Сервис аккаунтов временно недоступен.", {}],
    [401, "/api/account/profile", "Войдите в аккаунт или проверьте почту, пароль и код.", {}],
  ]) {
    respond(() => Response.json({ code: "ACCOUNT_NOT_FOUND" }, { status, headers }));
    await assert.rejects(accountRequest(path, input, "", false), { message });
  }
});

test("successful login responses and request protections remain intact", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/api/auth/login");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["X-AnimeSoul-Request"], "1");
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json({ authenticated: true });
  };
  assert.deepEqual(await login(), { authenticated: true });
});
