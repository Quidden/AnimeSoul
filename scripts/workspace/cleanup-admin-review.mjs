import { readFile, unlink } from "node:fs/promises";
import { createDatabase } from "../../packages/database/dist/src/index.js";
const url = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Requires the local AnimeSoul cluster.");
url.pathname = "/animesoul_test";
const db = createDatabase(url.href);
try {
  const state = JSON.parse(
    await readFile("artifacts/admin-modernization/review-state.json", "utf8").catch(() => "null"),
  );
  const users = await db.user.findMany({
    where: {
      AND: [
        { email: { endsWith: "@example.invalid" } },
        { OR: [{ email: { startsWith: "review-" } }, { email: { startsWith: "member-" } }] },
        { profile: { username: { in: ["AdminReview", "ReviewMember"] } } },
      ],
    },
    select: { id: true, createdAt: true },
  });
  const ids = users.map((u) => u.id);
  const changes = await db.auditEvent.findMany({
    where: { actorId: { in: ids } },
    select: { action: true, objectId: true, details: true },
  });
  await db.announcement.deleteMany({
    where: {
      id: {
        in: changes
          .filter((e) => e.action === "admin.announcements.saved")
          .flatMap((e) => (e.objectId ? [e.objectId] : [])),
      },
    },
  });
  await db.notificationCampaign.deleteMany({
    where: {
      id: {
        in: changes
          .filter((e) => e.action === "admin.notifications.saved")
          .flatMap((e) => (e.objectId ? [e.objectId] : [])),
      },
    },
  });
  if (state?.winter && changes.some((e) => e.action === "admin.appearance.winter"))
    await db.siteSetting.update({
      where: { key: "appearance.winter" },
      data: { value: state.winter.value, version: state.winter.version },
    });
  const publications = changes.filter((e) => e.action === "admin.template.published");
  await db.notificationCampaign.deleteMany({
    where: {
      id: {
        in: publications
          .filter((e) => e.details?.route === "notifications")
          .map((e) => e.details.targetId),
      },
    },
  });
  await db.announcement.deleteMany({
    where: {
      id: {
        in: publications
          .filter((e) => ["announcements", "anime-notices"].includes(e.details?.route))
          .map((e) => e.details.targetId),
      },
    },
  });
  await db.siteSetting.deleteMany({
    where: {
      key: {
        in: changes
          .filter((e) => ["admin.template.saved", "admin.template.copied"].includes(e.action))
          .map((e) => "template." + e.objectId),
      },
    },
  });
  if (
    state &&
    changes.some(
      (e) =>
        e.action === "admin.maintenance.saved" ||
        (e.action === "admin.template.published" && e.details?.route === "maintenance"),
    )
  ) {
    if (state.maintenance)
      await db.siteSetting.upsert({
        where: { key: state.maintenance.key },
        create: state.maintenance,
        update: { value: state.maintenance.value, version: state.maintenance.version },
      });
    else await db.siteSetting.deleteMany({ where: { key: "availability.maintenance" } });
  }
  const visitors = await db.analyticsEvent.findMany({
    where: { userId: { in: ids } },
    select: { visitorId: true },
    distinct: ["visitorId"],
  });
  const startedAt = users.length
    ? new Date(Math.min(...users.map((u) => u.createdAt.getTime())))
    : new Date();
  await db.analyticsEvent.deleteMany({
    where: {
      OR: [
        { userId: { in: ids } },
        { visitorId: { in: visitors.map((v) => v.visitorId) }, createdAt: { gte: startedAt } },
      ],
    },
  });
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  console.log(JSON.stringify({ testFixturesRemoved: ids.length }));
  await unlink("artifacts/admin-modernization/review-state.json").catch(() => {});
} finally {
  await db.$disconnect();
}
