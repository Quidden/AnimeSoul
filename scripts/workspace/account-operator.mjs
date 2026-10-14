import { createDatabase } from "../../packages/database/dist/src/index.js";
import { randomToken, digest } from "../../apps/api/dist/auth/security.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const [action, identifier, reason] = process.argv.slice(2);
if (!["claim", "owner"].includes(action) || !identifier)
  throw new Error(
    'Usage: pnpm account:operator claim|owner <user UUID|email|username> ["reason for owner grant"]',
  );
const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Operator command requires an explicitly local database.");
const database = createDatabase(url.href);
try {
  const user = await database.user.findFirst({
    where: /^[a-f0-9-]{36}$/.test(identifier)
      ? { id: identifier }
      : {
          OR: [
            { email: identifier.trim().toLowerCase() },
            { profile: { usernameKey: identifier.trim().toLowerCase() } },
          ],
        },
    include: { legacy: true, profile: true },
  });
  if (!user || user.disabledAt) throw new Error("Active user not found.");
  if (action === "claim") {
    if (!user.legacy || user.email || user.passwordHash || user.legacy.claimedAt)
      throw new Error("Only an unclaimed imported profile can receive a claim code.");
    const code = randomToken();
    const expiresAt = new Date(Date.now() + 86400000);
    await database.$transaction([
      database.legacyProfile.update({
        where: { userId: user.id },
        data: { claimHash: digest(code), claimExpiresAt: expiresAt },
      }),
      database.auditEvent.create({
        data: {
          action: "operator.claim-code-issued",
          objectId: user.id,
          reason: "Local owner recovery; previous code invalidated.",
        },
      }),
    ]);
    mkdirSync("artifacts/stage2", { recursive: true });
    const file = path.resolve(`artifacts/stage2/claim-${user.id}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { userId: user.id, username: user.profile?.username, code, expiresAt },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.info("One-time claim code saved privately to " + file);
  } else {
    if (!user.email || !user.passwordHash)
      throw new Error("Claim or register the account before granting ownership.");
    if (!reason || reason.trim().length < 10)
      throw new Error("Owner grant requires an explicit reason of at least 10 characters.");
    await database.$transaction([
      database.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "owner" } },
        create: { userId: user.id, role: "owner" },
        update: {},
      }),
      database.session.updateMany({
        where: { userId: user.id, audience: "admin" },
        data: { revokedAt: new Date() },
      }),
      database.auditEvent.create({
        data: {
          action: "operator.owner-granted",
          objectId: user.id,
          reason: reason.trim().slice(0, 500),
        },
      }),
    ]);
    console.info("Owner role explicitly granted. Admin sign-in still requires MFA.");
  }
} finally {
  await database.$disconnect();
}
