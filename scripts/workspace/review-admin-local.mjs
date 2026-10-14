import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { setInterval, clearInterval } from "node:timers";
import { writeFile, access, unlink } from "node:fs/promises";
import { createDatabase } from "../../packages/database/dist/src/index.js";
import { createApplication } from "../../apps/api/dist/app.js";
import { readConfig } from "../../apps/api/dist/config.js";
import { AuthService } from "../../apps/api/dist/auth/auth.service.js";
import {
  encryptSecret,
  newTotpSecret,
  totp,
  hashPassword,
} from "../../apps/api/dist/auth/security.js";
import { privateVisibility } from "../../packages/contracts/dist/index.js";
const url = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Requires the local AnimeSoul cluster.");
url.pathname = "/animesoul_test";
const key = randomBytes(32).toString("hex"),
  config = readConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: url.href,
    API_PORT: "18820",
    SITE_URL: "http://localhost:18821",
    ADMIN_URL: "http://localhost:18822",
    MFA_ENCRYPTION_KEY: key,
    ALLOW_KODIK: "false",
    ALLOW_YUMMY: "false",
  });
const db = createDatabase(url.href),
  id = randomUUID(),
  secret = newTotpSecret(),
  email = "review-" + id.slice(0, 8) + "@example.invalid",
  password = "Admin review test account 2026!";
await db.user.create({
  data: {
    id,
    email,
    passwordHash: await hashPassword(password),
    roles: { create: { role: "owner" } },
    profile: {
      create: {
        username: "AdminReview",
        usernameKey: "admin-review-" + id,
        visibility: privateVisibility,
        content: {},
      },
    },
    mfa: {
      create: {
        secretEncrypted: encryptSecret(secret, key, id),
        enabledAt: new Date(),
        recoveryHashes: [],
      },
    },
  },
});
const memberId = randomUUID();
await db.user.create({
  data: {
    id: memberId,
    email: "member-" + memberId.slice(0, 8) + "@example.invalid",
    passwordHash: "TEST_ONLY_INVALID_PASSWORD_HASH",
    profile: {
      create: {
        username: "ReviewMember",
        usernameKey: "reviewmember",
        visibility: privateVisibility,
        content: {},
      },
    },
  },
});
const app = await createApplication(config);
await app.listen(18820, "127.0.0.1");
const env = {
  ...process.env,
  API_URL: "http://127.0.0.1:18820",
  SITE_URL: config.SITE_URL,
  ADMIN_URL: config.ADMIN_URL,
  NEXT_TELEMETRY_DISABLED: "1",
};
const winterBefore = await db.siteSetting.findUnique({ where: { key: "appearance.winter" } });
const maintenanceBefore = await db.siteSetting.findUnique({
  where: { key: "availability.maintenance" },
});
await unlink("artifacts/admin-modernization/stop-review").catch(() => {});
await writeFile(
  "artifacts/admin-modernization/review-state.json",
  JSON.stringify({ ids: [id, memberId], winter: winterBefore, maintenance: maintenanceBefore }),
);
const children = ["admin", "web"].map((name) =>
  spawn(
    process.execPath,
    [
      path.resolve("apps/" + name + "/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(name === "admin" ? 18822 : 18821),
    ],
    {
      cwd: path.resolve("apps/" + name),
      env,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    },
  ),
);
console.log(
  JSON.stringify({
    testOnly: true,
    email,
    password,
    code: totp(secret, Math.floor(Date.now() / 30000)),
    admin: config.ADMIN_URL,
    web: config.SITE_URL,
  }),
);
const codes = setInterval(
  () => console.log("TEST MFA: " + totp(secret, Math.floor(Date.now() / 30000))),
  30000,
);
const stopMonitor = setInterval(() => {
  void access("artifacts/admin-modernization/stop-review")
    .then(() => stop())
    .catch(() => {});
}, 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(codes);
  clearInterval(stopMonitor);
  for (const child of children) child.kill();
  const changes = await db.auditEvent.findMany({
    where: { actorId: id },
    select: { action: true, objectId: true, details: true },
  });
  const announcementIds = changes
    .filter((e) => e.action === "admin.announcements.saved")
    .flatMap((e) => (e.objectId ? [e.objectId] : []));
  const campaignIds = changes
    .filter((e) => e.action === "admin.notifications.saved")
    .flatMap((e) => (e.objectId ? [e.objectId] : []));
  for (const e of changes.filter((e) => e.action === "admin.template.published")) {
    if (e.details?.route === "notifications") campaignIds.push(e.details.targetId);
    if (["announcements", "anime-notices"].includes(e.details?.route))
      announcementIds.push(e.details.targetId);
  }
  await db.siteSetting.deleteMany({
    where: {
      key: {
        in: changes
          .filter((e) => ["admin.template.saved", "admin.template.copied"].includes(e.action))
          .map((e) => "template." + e.objectId),
      },
    },
  });
  await db.announcement.deleteMany({ where: { id: { in: announcementIds } } });
  await db.notificationCampaign.deleteMany({ where: { id: { in: campaignIds } } });
  if (winterBefore)
    await db.siteSetting.update({
      where: { key: "appearance.winter" },
      data: { value: winterBefore.value, version: winterBefore.version },
    });
  if (maintenanceBefore)
    await db.siteSetting.upsert({
      where: { key: maintenanceBefore.key },
      create: maintenanceBefore,
      update: { value: maintenanceBefore.value, version: maintenanceBefore.version },
    });
  else await db.siteSetting.deleteMany({ where: { key: "availability.maintenance" } });
  if (!winterBefore) await db.siteSetting.deleteMany({ where: { key: "appearance.winter" } });
  await db.auditEvent.deleteMany({ where: { actorId: id } });
  const visitors = await db.analyticsEvent.findMany({
    where: { userId: { in: [id, memberId] } },
    select: { visitorId: true },
    distinct: ["visitorId"],
  });
  const created = await db.user.findMany({
    where: { id: { in: [id, memberId] } },
    select: { createdAt: true },
  });
  await db.analyticsEvent.deleteMany({
    where: {
      OR: [
        { userId: { in: [id, memberId] } },
        {
          visitorId: { in: visitors.map((v) => v.visitorId) },
          createdAt: {
            gte: created.length
              ? new Date(Math.min(...created.map((u) => u.createdAt.getTime())))
              : new Date(),
          },
        },
      ],
    },
  });
  await db.user.deleteMany({ where: { id: { in: [id, memberId] } } });
  await app.close();
  await app.get(AuthService).db.$disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
