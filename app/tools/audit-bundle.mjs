import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const distDirectory = path.resolve(process.cwd(), process.argv[2] ?? "frontend/dist");
const htmlPath = path.join(distDirectory, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

function assetPath(pattern, label) {
  const match = html.match(pattern);
  if (!match) throw new Error(`Could not find ${label} in ${htmlPath}`);
  return path.join(distDirectory, match[1].replace(/^\//, ""));
}

function sizeOf(filePath) {
  const source = fs.readFileSync(filePath);
  return { raw: source.length, gzip: gzipSync(source).length };
}

function kib(value) {
  return `${(value / 1024).toFixed(2)} KiB`;
}

const entryJavaScript = assetPath(
  /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/,
  "module entry",
);
const entryStyles = assetPath(
  /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/,
  "entry stylesheet",
);
const preloadAssets = [...html.matchAll(
  /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/g,
)].map(match => match[1]);
const forbiddenInitialChunk = /(?:Player|DownloadsPage|StatisticsPage|RatingsPage|CollectionOverview|FolderView|source-map|hls)-/i;

const assetDirectory = path.join(distDirectory, "assets");
const javaScriptFiles = fs.readdirSync(assetDirectory)
  .filter(fileName => fileName.endsWith(".js"))
  .map(fileName => path.join(assetDirectory, fileName));
const largestJavaScript = javaScriptFiles
  .map(filePath => ({ filePath, ...sizeOf(filePath) }))
  .sort((left, right) => right.raw - left.raw)[0];

const budgets = {
  entryJavaScript: 300 * 1024,
  entryStyles: 315 * 1024,
  largestJavaScript: 580 * 1024,
};
const measurements = [
  { label: "entry JavaScript", filePath: entryJavaScript, ...sizeOf(entryJavaScript), limit: budgets.entryJavaScript },
  { label: "entry stylesheet", filePath: entryStyles, ...sizeOf(entryStyles), limit: budgets.entryStyles },
  { label: "largest lazy/vendor chunk", ...largestJavaScript, limit: budgets.largestJavaScript },
];

let failed = false;
for (const measurement of measurements) {
  const passed = measurement.raw <= measurement.limit;
  if (!passed) failed = true;
  console.log(
    `${passed ? "ok" : "over budget"}: ${measurement.label} ${kib(measurement.raw)} `
      + `(gzip ${kib(measurement.gzip)}, limit ${kib(measurement.limit)}) `
      + `— ${path.basename(measurement.filePath)}`,
  );
}

const eagerFeatureChunks = preloadAssets.filter(asset => forbiddenInitialChunk.test(asset));
if (eagerFeatureChunks.length > 0) {
  failed = true;
  console.error(`feature chunks unexpectedly preloaded: ${eagerFeatureChunks.join(", ")}`);
} else {
  console.log(`ok: ${preloadAssets.length} startup preload${preloadAssets.length === 1 ? "" : "s"}, no lazy feature chunks`);
}

if (failed) process.exitCode = 1;
