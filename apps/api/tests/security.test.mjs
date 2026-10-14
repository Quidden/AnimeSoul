import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { AuthService } from "../dist/auth/auth.service.js";
import {
  hashPassword,
  verifyPassword,
  totp,
  totpCounter,
  newTotpSecret,
  encryptSecret,
  decryptSecret,
} from "../dist/auth/security.js";
test("remembered admin cookies keep Secure, HttpOnly, SameSite and logout expiry", () => {
  const auth = new AuthService({ NODE_ENV: "production" });
  const cookie = auth.sessionCookie("test-token", "admin", false, true);
  assert.match(cookie, /Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  assert.match(auth.sessionCookie("", "admin", true, true), /Max-Age=0; Secure$/);
});
test("native Argon2id uses salted PHC hashes and rejects wrong and unknown credentials", async () => {
  const password = "Long private пароль 123";
  const hash = await hashPassword(password);
  assert.match(hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password + "x", hash), false);
  assert.equal(await verifyPassword(password, null), false);
  assert.notEqual(await hashPassword(password), hash);
});
test("TOTP matches RFC 6238 SHA1 vectors and uses authenticated per-user encryption", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [time, expected] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])
    assert.equal(totp(secret, Math.floor(time / 30)), expected);
  assert.equal(totpCounter(secret, "287082", 59000), 1);
  assert.equal(totpCounter(secret, "000000", 59000), null);
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/);
  const key = randomBytes(32).toString("hex"),
    userId = randomUUID();
  const encrypted = encryptSecret(secret, key, userId);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptSecret(encrypted, key, userId), secret);
  assert.throws(() => decryptSecret(encrypted, key, randomUUID()));
  assert.throws(() => decryptSecret(encrypted, randomBytes(32).toString("hex"), userId));
});
