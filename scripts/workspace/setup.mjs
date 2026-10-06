import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8").replaceAll("replace-with-random-local-password", password),
    { flag: "wx", mode: 0o600 },
  );
  console.info("Created local .env. Existing configurations are never overwritten.");
} else console.info("Existing .env preserved.");
