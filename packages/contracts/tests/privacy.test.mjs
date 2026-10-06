import test from "node:test";
import assert from "node:assert/strict";
import { publicProfile, providerDecision } from "../dist/index.js";
const record = {
  id: "00000000-0000-4000-8000-000000000010",
  username: "soul",
  indexable: false,
  avatar: null,
  banner: null,
  badge: null,
  presence: "invisible",
  about: "PRIVATE_MARKER",
  favoriteIds: ["PRIVATE_MARKER"],
  folders: [{ name: "PRIVATE_MARKER", animeIds: [] }],
  ratings: [{ animeId: "PRIVATE_MARKER", score: 10 }],
  statistics: { watched: 999, minutes: 999 },
  visibility: { about: false, favorites: false, folders: false, ratings: false, statistics: false },
  email: "PRIVATE_MARKER",
  passwordHash: "PRIVATE_MARKER",
};
test("hidden blocks and account data never leave server serializer", () => {
  const result = publicProfile(record);
  assert.equal(result.presence, "offline");
  for (const key of [
    "about",
    "favoriteIds",
    "folders",
    "ratings",
    "statistics",
    "visibility",
    "email",
    "passwordHash",
  ])
    assert.equal(key in result, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_MARKER"), false);
});
test("visibility can change without mutating stored record", () => {
  assert.equal(
    publicProfile({ ...record, visibility: { ...record.visibility, about: true } }).about,
    "PRIVATE_MARKER",
  );
  assert.equal(record.presence, "invisible");
});
test("deployment restrictions override provider setting", () => {
  assert.equal(
    providerDecision({ environmentAllows: false, settingEnabled: true, hasCredentials: true }),
    "environment-blocked",
  );
  assert.equal(
    providerDecision({ environmentAllows: true, settingEnabled: false, hasCredentials: true }),
    "disabled",
  );
  assert.equal(
    providerDecision({ environmentAllows: true, settingEnabled: true, hasCredentials: false }),
    "missing-credentials",
  );
});
