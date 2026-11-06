import test from "node:test";
import assert from "node:assert/strict";
import {
  rateLimitErrorSchema,
  frameSearchLimitResponseSchema,
  frameSearchQuotaSchema,
} from "../dist/index.js";

test("rate-limit errors have a stable code and a positive retry duration", () => {
  const body = { statusCode: 429, code: "RATE_LIMITED", message: "Подождите", retryAfter: 60 };
  assert.deepEqual(rateLimitErrorSchema.parse(body), body);
  for (const bad of [
    { code: "unknown" },
    { statusCode: 500 },
    { retryAfter: 0 },
    { retryAfter: -1 },
    { retryAfter: 1.5 },
    { retryAfter: 86401 },
  ])
    assert.equal(rateLimitErrorSchema.safeParse({ ...body, ...bad }).success, false);
});

test("frame quotas retain the provider contract and expose both daily budgets", () => {
  const provider = { total: 100, used: 12, remaining: 88 };
  assert.deepEqual(frameSearchQuotaSchema.parse(provider), provider);
  assert.equal(frameSearchLimitResponseSchema.safeParse(provider).success, false);
  const value = {
    ...provider,
    providerAvailable: true,
    personal: { total: 10, used: 3, remaining: 7, resetAfter: 3600, scope: "user" },
    global: { ...provider, resetAfter: 3600 },
  };
  assert.deepEqual(frameSearchLimitResponseSchema.parse(value), value);
  assert.equal(
    frameSearchLimitResponseSchema.safeParse({
      ...value,
      personal: { ...value.personal, scope: "cookie" },
    }).success,
    false,
  );
});
