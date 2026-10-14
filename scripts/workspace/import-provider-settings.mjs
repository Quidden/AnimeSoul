import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const file = process.argv[2];
if (!file) throw new Error("Provide the archived animesoul.python.json path.");
const config = JSON.parse(readFileSync(file, "utf8"));
const data = path.resolve(path.dirname(file), config.data_directory ?? "data");
const kodikFile = path.join(data, "animesoul-offline-settings.json");
const kodik = existsSync(kodikFile) ? JSON.parse(readFileSync(kodikFile, "utf8")) : {};
const values = {
  YUMMY_TOKEN: config.yummy_public_token ?? config.yummyAnimeToken ?? "",
  KODIK_TOKEN: kodik.kodikPublicKey ?? "",
};
let content = readFileSync(".env", "utf8");
const existing = parseEnv(content);
for (const [key, value] of Object.entries(values)) {
  if (!value || existing[key]) continue;
  if (typeof value !== "string" || !/^[\w.-]{1,512}$/.test(value))
    throw new Error("Unsupported credential format for " + key);
  const line = key + "=" + value;
  content = new RegExp("^" + key + "=.*$", "m").test(content)
    ? content.replace(new RegExp("^" + key + "=.*$", "m"), line)
    : content.trimEnd() + "\n" + line + "\n";
}
writeFileSync(".env", content, { mode: 0o600 });
console.info(
  "Imported server credentials without printing them. Provider switches remain explicit.",
);
