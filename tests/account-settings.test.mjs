import test from "node:test";
import assert from "node:assert/strict";
import { accountSectionFromUrl, accountSettingsHref } from "../apps/web/lib/account-settings.ts";

test("settings destinations carry a router-visible section and keep legacy anchors", () => {
  for (const section of ["privacy-settings", "media-settings", "profile-settings"]) {
    const destination = new URL(accountSettingsHref(section), "http://localhost:8021");
    assert.equal(destination.pathname, "/account");
    assert.equal(destination.searchParams.get("section"), section);
    assert.equal(accountSectionFromUrl(destination), section);
    assert.equal(
      accountSectionFromUrl(new URL("http://localhost:8021/account#" + section)),
      section,
    );
  }
  assert.equal(
    accountSectionFromUrl(new URL("http://localhost:8021/account?section=media-settings")),
    "media-settings",
  );
  assert.equal(
    accountSectionFromUrl(
      new URL("http://localhost:8021/account?section=privacy-settings#profile-settings"),
    ),
    "profile-settings",
  );
  assert.equal(
    accountSectionFromUrl(new URL("http://localhost:8021/account?section=unknown#unknown")),
    null,
  );
  assert.equal(accountSectionFromUrl(new URL("http://localhost:8021/account")), null);
});

test("identity callbacks keep their section without exposing the token in settings links", () => {
  assert.equal(
    accountSectionFromUrl(new URL("http://localhost:8021/account#action=verify&token=test")),
    "identity-settings",
  );
  assert.equal(
    accountSectionFromUrl(new URL("http://localhost:8021/account?oauth=done")),
    "identity-settings",
  );
  assert.equal(
    accountSettingsHref("identity-settings"),
    "/account?section=identity-settings#identity-settings",
  );
});
