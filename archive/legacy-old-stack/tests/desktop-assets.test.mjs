import assert from "node:assert/strict";
import test from "node:test";
import { startSiteServer } from "../desktop/site-server.mjs";

test("desktop server returns its generated CSS and JavaScript assets", async () => {
  const server = await startSiteServer({ root: process.cwd(), port: 32111 });
  try {
    const page = await fetch("http://127.0.0.1:32111/");
    assert.equal(page.status, 200);
    const html = await page.text();
    const assets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => url.includes("/assets/"));
    assert.ok(assets.some((url) => url.endsWith(".css")), "HTML must reference generated CSS");
    assert.ok(assets.some((url) => url.endsWith(".js")), "HTML must reference generated JavaScript");

    for (const asset of assets) {
      const response = await fetch(new URL(asset, page.url));
      assert.equal(response.status, 200, `${asset} must be available`);
      assert.ok((await response.arrayBuffer()).byteLength > 0, `${asset} must not be empty`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
