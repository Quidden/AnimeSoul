import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/theme.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { parseTheme, themeBootstrap, themeStorageKey } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("theme bootstrap restores only known device preferences before client components load", () => {
  for (const stored of ["lilac", "graphite", null, "light", '<script>alert("x")</script>']) {
    let theme = "lilac";
    runInNewContext(themeBootstrap, {
      localStorage: {
        getItem(key) {
          assert.equal(key, themeStorageKey);
          return stored;
        },
      },
      document: {
        documentElement: {
          setAttribute(name, value) {
            assert.equal(name, "data-theme");
            theme = value;
          },
        },
      },
    });
    assert.equal(theme, stored === "graphite" ? "graphite" : "lilac");
    assert.equal(parseTheme(stored), stored === "lilac" || stored === "graphite" ? stored : null);
  }
});

test("denied browser storage does not break initial page rendering", () => {
  const context = {
    document: {
      documentElement: {
        setAttribute() {
          assert.fail("Default theme must remain intact");
        },
      },
    },
  };
  Object.defineProperty(context, "localStorage", {
    get() {
      throw new Error("Browser storage is blocked");
    },
  });
  assert.doesNotThrow(() => runInNewContext(themeBootstrap, context));
  assert.doesNotThrow(() =>
    runInNewContext(themeBootstrap, {
      localStorage: {
        getItem() {
          throw new Error("Reading browser storage is blocked");
        },
      },
      document: context.document,
    }),
  );
});
