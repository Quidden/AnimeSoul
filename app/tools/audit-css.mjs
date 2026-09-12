import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postcss from "../frontend/node_modules/postcss/lib/postcss.js";

const entry = path.resolve(process.cwd(), process.argv[2] ?? "frontend/src/globals.css");
const seenFiles = new Set();
const rules = [];
const duplicateDeclarations = [];

function normalizeSpace(value) {
  return value.trim().replace(/\s+/g, " ");
}

function contextFor(node) {
  const context = [];
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule") {
      context.unshift(`@${parent.name} ${normalizeSpace(parent.params)}`);
    }
    parent = parent.parent;
  }
  return context.join(" > ");
}

function recordRules(root, filePath) {
  root.walkRules(rule => {
    const declarations = rule.nodes.filter(node => node.type === "decl");
    if (declarations.length === 0) return;

    const declarationKeys = new Set();
    for (const declaration of declarations) {
      const key = `${declaration.prop}\0${normalizeSpace(declaration.value)}\0${declaration.important}`;
      if (declarationKeys.has(key)) {
        duplicateDeclarations.push({
          filePath,
          line: declaration.source?.start?.line ?? 0,
          selector: normalizeSpace(rule.selector),
          property: declaration.prop,
        });
      }
      declarationKeys.add(key);
    }

    const body = declarations
      .map(declaration => (
        `${declaration.prop}:${normalizeSpace(declaration.value)}${declaration.important ? "!important" : ""}`
      ))
      .join(";");
    rules.push({
      filePath,
      line: rule.source?.start?.line ?? 0,
      selector: normalizeSpace(rule.selector),
      context: contextFor(rule),
      body,
    });
  });
}

function loadStyleSheet(filePath) {
  const resolved = path.resolve(filePath);
  if (seenFiles.has(resolved)) return;
  seenFiles.add(resolved);
  const root = postcss.parse(fs.readFileSync(resolved, "utf8"), { from: resolved });

  for (const node of root.nodes) {
    if (node.type === "atrule" && node.name === "import") {
      const match = node.params.match(/^["'](.+\.css)["']/);
      if (match) loadStyleSheet(path.resolve(path.dirname(resolved), match[1]));
    }
  }
  recordRules(root, resolved);
}

loadStyleSheet(entry);

const firstBySignature = new Map();
const duplicateRules = [];
for (const rule of rules) {
  const signature = `${rule.context}\0${rule.selector}\0${rule.body}`;
  const first = firstBySignature.get(signature);
  if (first) duplicateRules.push({ first, duplicate: rule });
  else firstBySignature.set(signature, rule);
}

function relativeLocation(item) {
  return `${path.relative(process.cwd(), item.filePath)}:${item.line}`;
}

for (const { first, duplicate } of duplicateRules) {
  console.log(
    `duplicate rule ${JSON.stringify(duplicate.selector)}: ${relativeLocation(first)} -> ${relativeLocation(duplicate)}`,
  );
}
for (const duplicate of duplicateDeclarations) {
  console.log(
    `duplicate declaration ${duplicate.property} in ${JSON.stringify(duplicate.selector)} at ${relativeLocation(duplicate)}`,
  );
}

const issueCount = duplicateRules.length + duplicateDeclarations.length;
console.log(
  `${seenFiles.size} CSS files, ${rules.length} rules, ${issueCount} exact duplicate${issueCount === 1 ? "" : "s"}.`,
);
if (issueCount > 0) process.exitCode = 1;
