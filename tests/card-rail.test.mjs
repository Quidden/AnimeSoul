import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/card-rail.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { wholeCardRailLayout } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("card rails fit whole cards and leave symmetric room to center short lists", () => {
  const long = wholeCardRailLayout(1105, 154.6875, 20, 74);
  assert.deepEqual(long, { cardWidth: 154, columns: 6, width: 1024 });
  const short = wholeCardRailLayout(1800, 184, 20, 5);
  assert.deepEqual(short, { cardWidth: 184, columns: 5, width: 1000 });
  for (const available of [180, 251, 744, 1105, 1822]) {
    const { cardWidth, columns, width } = wholeCardRailLayout(available, 136, 14, 43);
    assert.ok(width <= available);
    assert.equal(width, columns * (cardWidth + 14) - 14);
    assert.equal((43 * cardWidth + 42 * 14 - width) % (cardWidth + 14), 0);
  }
  assert.deepEqual(wholeCardRailLayout(90, 136, 14, 10), { cardWidth: 90, columns: 1, width: 90 });
});
