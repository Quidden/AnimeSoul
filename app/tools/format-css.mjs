import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postcss from "../frontend/node_modules/postcss/lib/postcss.js";

const INDENT = "  ";

function formatContainer(container, depth) {
  const isRoot = container.type === "root";

  container.each((node, index) => {
    const indentation = INDENT.repeat(depth);
    const separator = isRoot ? (index > 0 ? "\n\n" : "") : "\n";
    node.raws.before = `${separator}${indentation}`;

    if (node.type === "decl") {
      node.raws.between = ": ";
      return;
    }

    if (node.type === "rule") {
      node.raws.between = " ";
    }

    if ("nodes" in node && node.nodes) {
      node.raws.semicolon = true;
      formatContainer(node, depth + 1);
      node.raws.after = `\n${indentation}`;
    }
  });
}

function formatFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const root = postcss.parse(source, { from: filePath });
  formatContainer(root, 0);
  root.raws.after = "\n";
  fs.writeFileSync(filePath, root.toString(), "utf8");
}

function expandFilePattern(filePattern) {
  if (!filePattern.includes("*")) {
    return [filePattern];
  }

  const directory = path.dirname(filePattern);
  const fileNamePattern = path.basename(filePattern);
  const matcher = new RegExp(
    `^${fileNamePattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")}$`,
    "i",
  );

  return fs
    .readdirSync(path.resolve(process.cwd(), directory))
    .filter(fileName => matcher.test(fileName))
    .map(fileName => path.join(directory, fileName));
}

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node tools/format-css.mjs <file.css> [...more.css]");
  process.exitCode = 1;
} else {
  for (const file of files.flatMap(expandFilePattern)) {
    formatFile(path.resolve(process.cwd(), file));
  }
}
