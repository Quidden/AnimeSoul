import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const staged = process.argv.includes("--staged");
const history = process.argv.includes("--history");
const git = (args) =>
  execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const files = history
  ? []
  : git(
      staged
        ? ["ls-files", "--cached", "-z"]
        : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    )
      .split("\0")
      .filter(Boolean);
const privateValues = new Map();
for (const file of readdirSync(".")) {
  if (!file.startsWith(".env") || file.endsWith(".example")) continue;
  if (!statSync(file).isFile()) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.replace(/^(["'])(.*)\1$/, "$2");
    if (/PASSWORD|SECRET|TOKEN|(?:^|_)KEY$/.test(name)) {
      if (value.length >= 8 && !/^(replace-|example|test|development)/i.test(value))
        privateValues.set(value, name);
    }
    if (name.endsWith("_URL")) {
      try {
        const password = decodeURIComponent(new URL(value).password);
        if (password.length >= 8 && !/^(replace-|example|test)/i.test(password))
          privateValues.set(password, `${name} password`);
      } catch {
        // Non-URL environment values do not contain URL credentials.
      }
    }
  }
}
const patterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Google OAuth secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g],
  ["Stripe live key", /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  [
    "embedded service credential",
    /\b(?:KODIK_TOKEN|YUMMY_TOKEN|KODIK_PRIVATE_KEY|MFA_ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET|TRACE_MOE_API_KEY|SMTP_PASSWORD)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_+/=-]{24,}["']/g,
  ],
];
const failures = new Set();
let checked = 0;
function check(file, data) {
  if (/(^|\/)\.env[^/]*$/.test(file) && !/(^|\/)\.env(?:\.[\w-]+)*\.example$/.test(file))
    failures.add(`${file}: private environment file`);
  if (/\.(?:pem|key|p12|pfx|dump|db|sqlite3?|sql\.gz)$/i.test(file))
    failures.add(`${file}: private key or database file`);
  if (data.length >= 100 * 1024 * 1024) failures.add(`${file}: exceeds GitHub's 100 MiB limit`);
  if (data.includes(0)) return;
  const content = data.toString("utf8");
  checked++;
  for (const [name, pattern] of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (
        name === "embedded service credential" &&
        /\.test\.mjs$/.test(file) &&
        /["'][A-Z_]+_SENTINEL["']$/.test(match[0])
      )
        continue;
      const line = content.slice(0, match.index).split("\n").length;
      failures.add(`${file}:${line}: ${name}`);
    }
  }
  for (const [value, name] of privateValues) {
    const positions = [content.indexOf(value), content.indexOf(encodeURIComponent(value))];
    for (const position of positions) {
      if (position < 0) continue;
      const line = content.slice(0, position).split("\n").length;
      failures.add(`${file}:${line}: value from private ${name}`);
    }
  }
}
if (history) {
  const objects = git(["rev-list", "--objects", "HEAD", "--not", "--remotes=origin"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return {
        sha: space < 0 ? line : line.slice(0, space),
        path: space < 0 ? line : line.slice(space + 1),
      };
    });
  const output = execFileSync("git", ["cat-file", "--batch"], {
    input: objects.map((object) => object.sha).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
  });
  let offset = 0;
  for (const object of objects) {
    const end = output.indexOf(10, offset);
    const [, type, sizeText] = output.subarray(offset, end).toString("utf8").split(" ");
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size)) throw new Error("Unable to read Git object");
    offset = end + 1;
    if (type === "blob") check(object.path, output.subarray(offset, offset + size));
    offset += size + 1;
  }
} else {
  for (const file of new Set(files)) {
    if (!staged && !existsSync(file)) continue;
    check(
      file,
      staged
        ? execFileSync("git", ["show", `:${file}`], { maxBuffer: 128 * 1024 * 1024 })
        : readFileSync(file),
    );
  }
}
if (failures.size) {
  console.error([...failures].join("\n"));
  process.exitCode = 1;
} else {
  console.info(
    `Checked ${checked} text files for known token patterns and local private values (${history ? "unpublished Git history" : staged ? "index" : "working tree"}).`,
  );
}
