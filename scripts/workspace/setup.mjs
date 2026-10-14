import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8")
      .replaceAll("replace-with-random-local-password", password)
      .replace(/^MFA_ENCRYPTION_KEY=$/m, "MFA_ENCRYPTION_KEY=" + randomBytes(32).toString("hex")),
    { flag: "wx", mode: 0o600 },
  );
  console.info("Created local .env. Existing configurations are never overwritten.");
} else console.info("Existing .env preserved.");

const existing = readFileSync(".env", "utf8");
if (!/^MFA_ENCRYPTION_KEY=.+/m.test(existing)) {
  writeFileSync(
    ".env",
    existing.replace(/^MFA_ENCRYPTION_KEY=.*\r?\n?/m, "") +
      "\nMFA_ENCRYPTION_KEY=" +
      randomBytes(32).toString("hex") +
      "\n",
    { mode: 0o600 },
  );
  console.info("Added private MFA encryption key; other settings preserved.");
}
const updated = readFileSync(".env", "utf8");
if (!/^MAIL_MODE=/m.test(updated) && !/^NODE_ENV=production\r?$/m.test(updated)) {
  writeFileSync(".env", updated + "\nMAIL_MODE=file\n", { mode: 0o600 });
  console.info("Enabled private local test mail; existing credentials preserved.");
}
