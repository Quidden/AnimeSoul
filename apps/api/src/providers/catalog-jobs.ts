import { createHash, randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { Database } from "@animesoul/database";
import { kodikPage, normalizeKodikAnime, saveKodikAnime } from "./kodik-catalog.js";
import { ProviderUnavailable, type ProvidersService } from "./providers.service.js";
const active = ["queued", "running", "paused"];
export async function enqueueCatalog(database: Database, actorId: string | null, reason: string) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731006, 4)`;
    const existing = await tx.catalogImportJob.findFirst({
      where: { provider: "kodik", status: { in: active } },
    });
    if (existing) return { id: existing.id, reused: true };
    const job = await tx.catalogImportJob.create({
      data: { provider: "kodik", strategy: "kodik-cursor" },
    });
    await tx.auditEvent.create({
      data: { action: "catalog.sync.enqueue", objectId: job.id, actorId, reason },
    });
    return { id: job.id, reused: false };
  });
}
export async function controlCatalog(
  database: Database,
  id: string,
  action: "resume" | "cancel",
  actorId: string | null,
  reason: string,
) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731006, 4)`;
    if (action === "resume") {
      const job = await tx.catalogImportJob.findUnique({ where: { id } });
      const other = await tx.catalogImportJob.findFirst({
        where: { provider: "kodik", status: { in: active }, id: { not: id } },
      });
      if (!job || job.provider !== "kodik" || job.strategy !== "kodik-cursor" || other)
        throw new ConflictException("Start a new import or finish the active job first.");
    }
    const updated = await tx.catalogImportJob.updateMany({
      where: { id, status: { in: action === "resume" ? ["paused", "failed"] : active } },
      data: {
        status: action === "resume" ? "queued" : "cancelled",
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: 0,
        nextRunAt: new Date(),
        lastError: null,
        finishedAt: action === "cancel" ? new Date() : null,
      },
    });
    if (!updated.count) throw new ConflictException("Job state changed. Refresh the list.");
    await tx.auditEvent.create({
      data: { action: "catalog.sync." + action, objectId: id, actorId, reason },
    });
    return { ok: true };
  });
}
/** A page and its opaque Kodik cursor commit atomically. Credentials and playback links never persist. */
export async function runCatalogPage(
  database: Database,
  providers: Pick<ProvidersService, "state" | "catalog">,
  now = new Date(),
) {
  const token = randomUUID();
  const job = await database.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; startedAt: Date | null }[]
    >`SELECT "id", "startedAt" FROM "CatalogImportJob" WHERE "provider" = 'kodik' AND ("status" = 'queued' OR ("status" = 'running' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now}))) AND "nextRunAt" <= ${now} ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return tx.catalogImportJob.update({
      where: { id: rows[0].id },
      data: {
        status: "running",
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + 120000),
        startedAt: rows[0].startedAt ?? now,
      },
    });
  });
  if (!job) return null;
  const owned = { id: job.id, status: "running", leaseToken: token };
  try {
    const state = await providers.state("kodik");
    if (state !== "enabled") throw new ProviderUnavailable(state);
    if (job.strategy !== "kodik-cursor" || job.pages >= 10000) throw new Error("invalid-page");
    const cursorHash = createHash("sha256")
      .update(job.cursor ?? "initial")
      .digest("hex");
    if (
      await database.catalogImportPage.findUnique({
        where: { jobId_cursorHash: { jobId: job.id, cursorHash } },
      })
    )
      throw new Error("repeated-page");
    const page = kodikPage(await providers.catalog(job.cursor), job.cursor);
    if (page.results.length && page.fingerprint === job.lastFingerprint)
      throw new Error("repeated-page");
    const normalized: ReturnType<typeof normalizeKodikAnime>[] = [];
    let rejected = 0;
    for (const raw of page.results) {
      try {
        normalized.push(normalizeKodikAnime(raw));
      } catch {
        rejected++;
      }
    }
    if (page.results.length && !normalized.length) throw new Error("invalid-page");
    const after = await providers.state("kodik");
    if (after !== "enabled") throw new ProviderUnavailable(after);
    await database.$transaction(
      async (tx) => {
        // Match the provider-disable lock order, then discard cancelled or expired leases.
        const setting = await tx.$queryRaw<
          { enabled: boolean }[]
        >`SELECT "enabled" FROM "ProviderSetting" WHERE "key" = 'kodik' FOR SHARE`;
        if (!setting[0]?.enabled) throw new ProviderUnavailable("disabled");
        await tx.$queryRaw`SELECT "id" FROM "CatalogImportJob" WHERE "id" = ${job.id}::uuid FOR UPDATE`;
        if (
          !(await tx.catalogImportJob.findFirst({
            where: { ...owned, leaseExpiresAt: { gt: new Date() } },
          }))
        )
          return;
        let conflicts = 0;
        for (const anime of normalized) conflicts += (await saveKodikAnime(tx, anime)).conflicts;
        await tx.catalogImportPage.create({ data: { jobId: job.id, cursorHash } });
        const done = page.next === null;
        await tx.catalogImportJob.update({
          where: { id: job.id },
          data: {
            status: done ? "completed" : "queued",
            cursor: page.next,
            offset: { increment: page.results.length },
            upperBound: job.upperBound ?? page.total,
            pages: { increment: 1 },
            imported: { increment: normalized.length },
            rejected: { increment: rejected },
            conflicts: { increment: conflicts },
            lastFingerprint: page.fingerprint,
            attempts: 0,
            lastError: null,
            leaseToken: null,
            leaseExpiresAt: null,
            nextRunAt: new Date(Date.now() + 1200),
            ...(done ? { finishedAt: new Date() } : {}),
          },
        });
        if (done)
          await tx.auditEvent.create({
            data: {
              action: "catalog.sync.complete",
              objectId: job.id,
              reason:
                "Kodik releases " +
                (job.imported + normalized.length) +
                "; rejected " +
                (job.rejected + rejected) +
                "; conflicts " +
                (job.conflicts + conflicts) +
                ".",
            },
          });
      },
      { timeout: 60000 },
    );
  } catch (error) {
    const paused = error instanceof ProviderUnavailable && error.state !== "error";
    const permanent =
      (error instanceof Error &&
        ["invalid-page", "repeated-page", "release-identity-changed"].includes(error.message)) ||
      (error instanceof ProviderUnavailable && error.code === "authentication");
    const attempts = job.attempts + 1;
    const code = paused
      ? error.state
      : error instanceof ProviderUnavailable
        ? error.code
        : permanent
          ? error.message
          : "upstream-unavailable";
    await database.catalogImportJob.updateMany({
      where: owned,
      data: {
        status: paused ? "paused" : permanent || attempts >= 5 ? "failed" : "queued",
        lastError: code,
        attempts,
        leaseToken: null,
        leaseExpiresAt: null,
        nextRunAt: new Date(
          Date.now() +
            Math.max(
              error instanceof ProviderUnavailable ? error.retryMs : 0,
              Math.min(600000, 5000 * 2 ** attempts),
            ),
        ),
        ...(permanent || attempts >= 5 ? { finishedAt: new Date() } : {}),
      },
    });
  }
  return database.catalogImportJob.findUnique({ where: { id: job.id } });
}
