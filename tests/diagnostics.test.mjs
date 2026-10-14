import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  diagnosticError,
  diagnosticPath,
  diagnosticText,
  normalizeDiagnostic,
} from "../packages/diagnostics/sanitize.mjs";
import { readDiagnostics, writeDiagnostic } from "../packages/diagnostics/index.mjs";

test("diagnostics remove URL credentials, queries, fragments, emails and tokens", () => {
  assert.equal(
    diagnosticPath("https://someone:secret@site.invalid/anime/abc?token=secret#time"),
    "/anime/abc",
  );
  const text = diagnosticText(
    "fetch https://user:password@site.invalid/stream?token=private#fragment email=test@example.invalid password=secret Bearer " +
      "a".repeat(43),
  );
  for (const secret of [
    "user:password",
    "private",
    "fragment",
    "test@example.invalid",
    "secret",
    "a".repeat(43),
  ])
    assert.equal(text.includes(secret), false, secret);
  assert.equal(diagnosticText("postgresql://user:private@localhost/db"), "[database]");
  assert.equal(diagnosticText("x ".repeat(6000)).length, 2000);
});

test("normalization retains diagnostic context and discards arbitrary metadata", () => {
  const value = normalizeDiagnostic({
    message: "failed",
    password: "private",
    cookie: "private",
    path: "/?q=private",
    userId: "forged",
    breadcrumbs: Array.from({ length: 20 }, () => ({
      kind: "navigation",
      path: "/anime/a?secret=private",
      body: "private",
    })),
  });
  assert.equal(value.path, "/");
  assert.equal(value.userId, null);
  assert.equal(value.breadcrumbs.length, 10);
  assert.equal(JSON.stringify(value).includes("private"), false);
  const error = diagnosticError(new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }));
  assert.equal(error.code, "ECONNREFUSED");
  assert.equal(
    diagnosticError(
      new Error("catalog failed", {
        cause: new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      }),
    ).code,
    "ECONNREFUSED",
  );
});

test("private logs persist ordered events, filter users, expire only owned files and cap disk use", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "animesoul-diagnostics-"));
  const previous = process.env.DIAGNOSTICS_DIR;
  process.env.DIAGNOSTICS_DIR = directory;
  try {
    await writeFile(path.join(directory, "2000-01-01.jsonl"), "old");
    await writeFile(path.join(directory, "keep.txt"), "unrelated");
    const userId = "b3a3f06d-30c2-4fc6-98c1-532f1c8bc644";
    const first = await writeDiagnostic({
      source: "browser",
      userId,
      message: "first",
      path: "/anime/a",
    });
    const second = await writeDiagnostic({
      source: "web",
      message: "second",
      code: "ECONNREFUSED",
      path: "/",
    });
    const all = await readDiagnostics();
    assert.deepEqual(
      all.items.map((item) => item.id),
      [second, first],
    );
    assert.equal((await readDiagnostics({ userId })).items[0].message, "first");
    assert.equal((await readDiagnostics({ query: "ECONNREFUSED", source: "web" })).items.length, 1);
    assert.equal((await readdir(directory)).includes("2000-01-01.jsonl"), false);
    assert.equal(await readFile(path.join(directory, "keep.txt"), "utf8"), "unrelated");
    const file = path.join(directory, new Date().toISOString().slice(0, 10) + ".jsonl");
    const text = await readFile(file, "utf8");
    assert.ok(JSON.parse(text.split("\n")[0]).time);
    await writeFile(file, " ".repeat(4 * 1024 * 1024));
    await writeDiagnostic({ message: "over cap" });
    assert.equal((await readFile(file)).byteLength, 4 * 1024 * 1024);
  } finally {
    if (previous === undefined) delete process.env.DIAGNOSTICS_DIR;
    else process.env.DIAGNOSTICS_DIR = previous;
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  }
});
