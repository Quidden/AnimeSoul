// Keeps colours out of component stylesheets: they belong in apps/web/styles/tokens.css.
//   node scripts/quality/check-css-colors.mjs           fail if a stylesheet has more colour literals than its baseline
//   node scripts/quality/check-css-colors.mjs --update  rewrite the baseline (after removing literals, or on purpose)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../..", import.meta.url)));
const web = "apps/web";
const baselinePath = "scripts/quality/css-colors.baseline.json";
// tokens.css defines the palette; theme.css defines the graphite theme values.
const allowed = new Set(["styles/tokens.css", "styles/theme.css"]);
const literal = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![\w-])|rgba?\([^()]*\)/g;

const files = [
  "app/globals.css",
  ...readdirSync(join(web, "styles")).map((name) => `styles/${name}`),
].filter((file) => file.endsWith(".css") && !allowed.has(file));
const counts = {};
for (const file of files) {
  // Colours inside url(...) (inline SVG) cannot use custom properties, so they are not counted.
  const text = readFileSync(join(web, file), "utf8").replace(/url\([^)]*\)/g, "");
  const count = (text.match(literal) ?? []).filter((match) => !/var\(/.test(match)).length;
  if (count) counts[file] = count;
}

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + "\n");
  console.log(
    `Baseline updated: ${Object.values(counts).reduce((sum, n) => sum + n, 0)} literals in ${Object.keys(counts).length} files.`,
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const grown = Object.entries(counts).filter(([file, count]) => count > (baseline[file] ?? 0));
if (grown.length) {
  console.error(
    "New colour literals in stylesheets. Use a token from apps/web/styles/tokens.css (or add one there):",
  );
  for (const [file, count] of grown)
    console.error(`  ${file}: ${count} (baseline ${baseline[file] ?? 0})`);
  process.exit(1);
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
console.log(
  `CSS colours OK: ${total} literals left outside tokens.css (baseline ${Object.values(baseline).reduce((s, n) => s + n, 0)}).`,
);
