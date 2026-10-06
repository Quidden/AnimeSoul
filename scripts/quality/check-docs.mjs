import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    ["node_modules", ".next", "dist", "generated"].includes(entry.name)
      ? []
      : entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
  );
}
const files = [
  "README.md",
  "README.ru.md",
  ...["docs", "apps", "packages", "scripts", "infra", "tests"]
    .flatMap(walk)
    .filter((f) => f.endsWith(".md")),
];
let count = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].split("#")[0];
    if (!link || /^[a-z]+:/i.test(link)) continue;
    if (!existsSync(path.resolve(path.dirname(file), decodeURIComponent(link))))
      throw new Error(file + ": missing " + link);
    count++;
  }
}
console.info(`Checked ${files.length} documents and ${count} local links.`);
