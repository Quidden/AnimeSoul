import test from "node:test";
import assert from "node:assert/strict";
import {
  passwordSchema,
  credentialsSchema,
  registrationSchema,
  claimSchema,
  adminLoginSchema,
} from "../dist/account.js";
import { resetPasswordSchema, emailChangeSchema, googleStartSchema } from "../dist/identity.js";

test("passwords accept 6 through 128 characters and reject values outside the limits", () => {
  for (const length of [0, 5, 6, 12, 128, 129]) {
    assert.equal(
      passwordSchema.safeParse("x".repeat(length)).success,
      length >= 6 && length <= 128,
    );
  }
});

test("sign-in, registration, transfer and identity actions use the same 6-character minimum", () => {
  const email = "password-boundary@example.invalid";
  const cases = [
    [credentialsSchema, { email }],
    [registrationSchema, { email, username: "boundary-test" }],
    [claimSchema, { email, code: "c".repeat(32) }],
    [adminLoginSchema, { email, code: "123456" }],
    [resetPasswordSchema, { token: "t".repeat(43) }],
    [emailChangeSchema, { email }],
    [googleStartSchema, { intent: "link" }],
  ];
  for (const [schema, fields] of cases) {
    assert.equal(schema.safeParse({ ...fields, password: "Qw7!x" }).success, false);
    assert.equal(schema.safeParse({ ...fields, password: "Qw7!xZ" }).success, true);
    assert.equal(schema.safeParse({ ...fields, password: "x".repeat(129) }).success, false);
  }
});
