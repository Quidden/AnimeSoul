import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const contracts = new URL("../packages/contracts/dist/index.js", import.meta.url).href;
const source = stripTypeScriptTypes(
  readFileSync("apps/web/lib/search-settings.ts", "utf8").replace(
    '"@animesoul/contracts"',
    JSON.stringify(contracts),
  ),
  { mode: "transform", disableExperimentalWarning: true },
);
const { findSearchSettings, searchSettings, popularSearchSettings } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("settings search resolves real controls by synonyms, typos and keyboard layout", () => {
  for (const [query, id, anchor] of [
    ["аватра", "profile", "profile-settings"],
    ["ghbdfnyjcnm", "privacy", "privacy-settings"],
    ["скрыть комментарии", "privacy", "privacy-settings"],
    ["настройки пароля", "security", "security-settings"],
    ["двухфакторная", "security", "security-settings"],
    ["email", "identity", "identity-settings"],
    ["сменить email", "identity", "identity-settings"],
    ["смена темы", "appearance", "appearance-settings"],
    ["настройки темы", "appearance", "appearance-settings"],
    ["графит", "appearance", "appearance-settings"],
    ["автозапуск", "player", "player-settings"],
    ["любимые озвучки", "player", "player-settings"],
  ]) {
    const result = findSearchSettings(query);
    assert.equal(result[0]?.id, id, query);
    assert.equal(result[0]?.href, "/account#" + anchor, query);
  }
});

test("settings query search ignores empty input and does not invent controls", () => {
  assert.deepEqual(findSearchSettings(""), []);
  assert.deepEqual(findSearchSettings(" , ; "), []);
  assert.equal(findSearchSettings("настройки").length, 4);
  assert.equal(findSearchSettings("settings").length, 4);
  assert.deepEqual(findSearchSettings("светлая тема"), []);
});

test("empty-search settings shortcuts stay searchable and lead to existing account controls", () => {
  assert.equal(popularSearchSettings[0]?.id, "appearance");
  assert.equal(popularSearchSettings.length, 6);
  assert.equal(new Set(popularSearchSettings.map(({ id }) => id)).size, 6);
  for (const setting of popularSearchSettings) {
    assert.ok(searchSettings.some(({ id, href }) => id === setting.id && href === setting.href));
    assert.match(
      setting.href,
      /^\/account#(?:appearance|profile|privacy|security|identity|player)-settings$/u,
    );
    assert.equal(findSearchSettings(setting.label)[0]?.id, setting.id, setting.label);
  }
});
