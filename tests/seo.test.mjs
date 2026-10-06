import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
const source = stripTypeScriptTypes(readFileSync("apps/web/lib/site.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { safeJsonLd, siteConfiguration } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
test("JSON-LD cannot terminate a script element", () => {
  const payload = { name: "</script><script>alert(1)</script>" };
  const json = safeJsonLd(payload);
  assert.equal(json.includes("</script>"), false);
  assert.deepEqual(JSON.parse(json), payload);
});
test("local previews and development fixtures cannot be indexed", () => {
  const old = { ...process.env };
  try {
    process.env.PUBLIC_INDEXING = "true";
    process.env.SITE_URL = "http://localhost:8021";
    assert.throws(siteConfiguration, /Indexing requires/);
    process.env.SITE_URL = "https://example.org";
    process.env.DEMO_CATALOG = "true";
    assert.throws(siteConfiguration, /Indexing requires/);
    process.env.DEMO_CATALOG = "false";
    assert.equal(siteConfiguration().indexable, true);
  } finally {
    process.env = old;
  }
});
