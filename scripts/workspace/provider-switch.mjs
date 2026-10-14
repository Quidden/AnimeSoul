import { createDatabase } from "../../packages/database/dist/src/index.js";
import { readConfig } from "../../apps/api/dist/config.js";
import { switchProvider } from "../../apps/api/dist/providers/provider-management.js";
const [name, action, ...parts] = process.argv.slice(2);
if (!["yummy", "kodik"].includes(name) || !["enable", "disable"].includes(action))
  throw new Error("Usage: pnpm providers:switch yummy|kodik enable|disable <reason>");
const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
try {
  await switchProvider(db, config, name, action === "enable", parts.join(" "));
  console.info(name + ": " + action + ". Saved with an operator audit entry.");
} finally {
  await db.$disconnect();
}
