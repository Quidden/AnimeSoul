import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/home-rail.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { homeRailStops, nearestRailStop, nextRailStop } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("a rail step advances one card including its gap, in both directions", () => {
  const stops = homeRailStops([0, 160, 320, 480, 640], 320);
  assert.deepEqual(stops, [0, 160, 320]);
  assert.equal(nextRailStop(stops, 0, 1), 160);
  assert.equal(nextRailStop(stops, 160, 1), 320);
  assert.equal(nextRailStop(stops, 320, -1), 160);
  assert.equal(nextRailStop(stops, 0, -1), 0);
  assert.equal(nextRailStop(stops, 320, 1), 320);
});

test("quick consecutive ticks use the queued destination without dropping a card", () => {
  const stops = homeRailStops([0, 276, 552, 828, 1104], 1104);
  let destination = nextRailStop(stops, 0, 1);
  destination = nextRailStop(stops, destination, 1);
  assert.equal(destination, 552);
  assert.equal(nextRailStop(stops, destination, -1), 276);
});

test("partial mobile viewports reach the final card, while non-overflowing rails stay still", () => {
  const stops = homeRailStops([0, 244, 488, 732], 630);
  assert.deepEqual(stops, [0, 244, 488, 630]);
  assert.equal(nextRailStop(stops, 488, 1), 630);
  assert.equal(nextRailStop(stops, 630, 1), 630);
  assert.equal(nearestRailStop(stops, 235), 1);
  assert.deepEqual(homeRailStops([0, 244], 0), [0]);
  assert.equal(nextRailStop([0], 0, 1), 0);
  assert.equal(nextRailStop([], 0, -1), 0);
});
