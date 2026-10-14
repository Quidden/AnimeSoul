import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import path from "node:path";
import { normalizeDiagnostic } from "./sanitize.mjs";

const dayLimit = 4 * 1024 * 1024;
const retention = 7 * 86400000;
let pending = Promise.resolve();
let cleaned = "";
export function diagnosticsDirectory() {
  const cwd = process.cwd();
  const root =
    ["web", "admin", "api"].includes(path.basename(cwd)) &&
    path.basename(path.dirname(cwd)) === "apps"
      ? path.resolve(cwd, "../..")
      : cwd;
  // Runtime log files are created on the host; they must not be bundled into a deployment.
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.DIAGNOSTICS_DIR ||
      path.join(root, "artifacts/diagnostics"),
  );
}
export async function writeDiagnostic(input) {
  const event = { id: randomUUID(), time: new Date().toISOString(), ...normalizeDiagnostic(input) };
  const task = async () => {
    const directory = diagnosticsDirectory();
    const day = event.time.slice(0, 10);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (cleaned !== directory + day) {
      for (const name of await readdir(/*turbopackIgnore: true*/ directory)) {
        if (
          /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) &&
          Date.parse(name.slice(0, 10)) < Date.now() - retention
        )
          await unlink(path.join(directory, name));
      }
      cleaned = directory + day;
    }
    const file = path.join(directory, day + ".jsonl");
    const size = await stat(file)
      .then((value) => value.size)
      .catch(() => 0);
    const line = JSON.stringify(event) + "\n";
    if (size + Buffer.byteLength(line) <= dayLimit) await appendFile(file, line, { mode: 0o600 });
  };
  pending = pending.then(task).catch(() => {
    // Monitoring must never turn a recoverable application error into another failure.
    console.error("AnimeSoul diagnostics could not write an event.");
  });
  await pending;
  return event.id;
}
export async function readDiagnostics({
  userId = "",
  source = "",
  query = "",
  from = "",
  to = "",
  page = 1,
  pageSize = 100,
} = {}) {
  await pending;
  const directory = diagnosticsDirectory();
  const files = await readdir(/*turbopackIgnore: true*/ directory).catch(() => []);
  const items = [];
  const size = Math.min(100, Math.max(10, Number(pageSize) || 100)),
    currentPage = Math.min(1000, Math.max(1, Number(page) || 1));
  const offset = (currentPage - 1) * size;
  let total = 0;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(from) : 0;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(to) + 86400000 : Infinity;
  const needle = String(query).toLowerCase().slice(0, 200);
  for (const name of files
    .filter(
      (name) =>
        /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) &&
        Date.parse(name.slice(0, 10)) >= Date.now() - retention,
    )
    .sort()
    .reverse()) {
    const file = path.join(directory, name);
    if ((await stat(file)).size > dayLimit) continue;
    const lines = (await readFile(file, "utf8")).trim().split("\n").reverse();
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        const event = { id: value.id, time: value.time, ...normalizeDiagnostic(value) };
        if (Date.parse(event.time) < start || Date.parse(event.time) >= end) continue;
        if (userId && event.userId !== userId) continue;
        if (source && event.source !== source) continue;
        if (
          needle &&
          ![event.message, event.path, event.digest, event.code, event.sessionId]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
          continue;
        if (total >= offset && items.length < size) items.push(event);
        total++;
      } catch {
        /* Ignore an incomplete final line from another process. */
      }
    }
  }
  return { items, total, page: currentPage, pageSize: size };
}
