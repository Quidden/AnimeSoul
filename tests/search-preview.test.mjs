import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/search-preview.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { searchPreviewDelay, searchPreviewMoved, searchPreviewPlacement } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("idle preview tolerates small tremors but resets after deliberate movement", () => {
  assert.equal(searchPreviewDelay, 900);
  const origin = { x: 210, y: 350 };
  assert.equal(searchPreviewMoved(origin, origin), false);
  assert.equal(searchPreviewMoved(origin, { x: 213, y: 354 }), false);
  assert.equal(searchPreviewMoved(origin, { x: 214, y: 355 }), true);
});

test("previews stay inside desktop and mobile search at every edge, even after details load", () => {
  for (const container of [
    { width: 1180, height: 672 },
    { width: 370, height: 824 },
    { width: 500, height: 340 },
  ]) {
    for (const anchor of [
      { left: 18, top: 180, width: 540, height: 100 },
      { left: container.width - 80, top: container.height - 100, width: 80, height: 100 },
      { left: -12, top: -40, width: 540, height: 100 },
    ]) {
      for (const height of [180, 360, 590, 900]) {
        const placement = searchPreviewPlacement({ container, anchor }, height);
        assert.ok(placement.width > 0 && placement.maxHeight > 0);
        assert.ok(placement.left >= 12 && placement.top >= 12);
        assert.ok(placement.left + placement.width <= container.width - 12);
        assert.ok(placement.top + Math.min(height, placement.maxHeight) <= container.height - 12);
      }
    }
  }
});
