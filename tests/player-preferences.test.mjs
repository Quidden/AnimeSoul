import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import {
  playerPreferencesSchema,
  readPlayerPreferences,
  resumeEpisodeHref,
} from "../packages/contracts/dist/index.js";
async function load(file) {
  const code = stripTypeScriptTypes(readFileSync(file, "utf8"), {
    mode: "transform",
    disableExperimentalWarning: true,
  }).replace(
    '"@animesoul/contracts"',
    JSON.stringify(pathToFileURL(process.cwd() + "/packages/contracts/dist/index.js").href),
  );
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
const { preferredDubbing } = await load("apps/web/lib/player-preferences.ts");
const { outputSize } = await load("apps/web/lib/upscale.ts");
test("explicit title voice beats the saved episode and favorites; unavailable voices fall back", () => {
  const a = { id: "a", translation: "AniLibria.TV" },
    b = { id: "b", translation: "Dream Cast" },
    c = { id: "c", translation: "27Gang" };
  const prefs = playerPreferencesSchema.parse({
    favoriteDubbings: ["Missing", "anilibria.tv", "Dream Cast"],
  });
  assert.equal(preferredDubbing([a, b, c], prefs, "27gang", "Dream Cast"), c);
  assert.equal(preferredDubbing([a, b, c], prefs, null, "Dream Cast"), b);
  assert.equal(preferredDubbing([a, b, c], prefs, "Unavailable"), a);
  assert.equal(preferredDubbing([c], prefs, null, "Unavailable", c), c);
  assert.equal(preferredDubbing([], prefs, "27Gang"), undefined);
});
test("preferences have safe bounded defaults and continuation URLs use fresh database progress", () => {
  assert.deepEqual(readPlayerPreferences(null), {
    resume: true,
    autoplay: false,
    favoriteDubbings: [],
  });
  assert.equal(playerPreferencesSchema.safeParse({ autoplay: "true" }).success, false);
  assert.equal(
    playerPreferencesSchema.safeParse({ favoriteDubbings: Array(51).fill("Dub") }).success,
    false,
  );
  assert.equal(resumeEpisodeHref("rezero", "episode"), "/anime/rezero/episodes/episode?resume=1");
});
test("upscale targets preserve aspect ratio and never downsample", () => {
  assert.deepEqual(outputSize(1280, 720, 1080), [1920, 1080]);
  assert.deepEqual(outputSize(1280, 720, 1440), [2560, 1440]);
  assert.deepEqual(outputSize(1280, 720, 2160), [3840, 2160]);
  assert.deepEqual(outputSize(640, 480, 1080), [1440, 1080]);
  assert.deepEqual(outputSize(3840, 2160, 1080), [3840, 2160]);
  assert.deepEqual(outputSize(0, 720, 2160), [0, 0]);
});
