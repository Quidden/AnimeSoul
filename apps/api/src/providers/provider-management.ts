import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Database } from "@animesoul/database";
import type { Configuration } from "../config.js";
import { providerAccess } from "./reserve-access.js";

export async function switchProvider(
  database: Database,
  config: Configuration,
  provider: "yummy" | "kodik",
  enabled: boolean,
  reason: string,
  actorId: string | null = null,
) {
  if (reason.trim().length < 3 || reason.length > 500)
    throw new BadRequestException("A reason is required.");
  if (enabled && (provider === "yummy" ? config.ALLOW_YUMMY : config.ALLOW_KODIK) !== "true")
    throw new ConflictException("Environment blocks this provider.");
  if (enabled && !(provider === "yummy" ? config.YUMMY_TOKEN : config.KODIK_TOKEN))
    throw new ConflictException("Provider credentials are missing.");
  return database.$transaction(async (tx) => {
    if (actorId) {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(731006, 5)");
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        include: { roles: true, permissions: true },
      });
      if (!actor || actor.disabledAt || !actor.passwordHash) throw new ForbiddenException();
      const access = providerAccess(actor);
      if (!(provider === "yummy" ? access.canSwitchReserve : access.canSwitchKodik))
        throw new ForbiddenException();
    }
    await tx.providerSetting.upsert({
      where: { key: provider },
      create: { key: provider, enabled },
      update: { enabled },
    });
    if (!enabled)
      await tx.catalogImportJob.updateMany({
        where: { provider, status: { in: ["queued", "running"] } },
        data: { status: "paused", leaseToken: null, leaseExpiresAt: null, lastError: "disabled" },
      });
    await tx.auditEvent.create({
      data: {
        action: enabled ? "provider.enable" : "provider.disable",
        objectId: provider,
        reason: reason.trim(),
        actorId,
      },
    });
    return { ok: true };
  });
}

export async function resolveMapping(
  database: Database,
  id: string,
  version: number,
  decision: "keep-existing" | "use-incoming",
  reason: string,
  actorId: string | null,
) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731006, 3)`;
    const conflict = await tx.providerMappingConflict.findUnique({ where: { id } });
    if (!conflict || conflict.status !== "open" || conflict.version !== version)
      throw new ConflictException("Review changed. Refresh the list.");
    if (!["shikimori", "kinopoisk"].includes(conflict.provider))
      throw new ConflictException("Primary identities cannot be reassigned.");
    const mapping = { provider: conflict.provider, externalId: conflict.externalId };
    const owner = await tx.animeProvider.findUnique({ where: { provider_externalId: mapping } });
    const previous = await tx.animeProvider.findUnique({
      where: {
        animeId_provider: { animeId: conflict.incomingAnimeId, provider: conflict.provider },
      },
    });
    if (
      (owner?.animeId ?? null) !== conflict.existingAnimeId ||
      (previous?.externalId ?? null) !== conflict.previousExternalId
    )
      throw new ConflictException("Mapping changed. Import again and refresh the list.");
    const chosen =
      decision === "use-incoming"
        ? conflict.incomingAnimeId
        : (conflict.existingAnimeId ?? conflict.incomingAnimeId);
    const ignored = decision === "keep-existing" && !conflict.existingAnimeId;
    if (decision === "use-incoming") {
      if (previous && previous.externalId !== mapping.externalId) {
        await tx.animeProvider.delete({
          where: {
            animeId_provider: { animeId: conflict.incomingAnimeId, provider: conflict.provider },
          },
        });
        const old = { provider: conflict.provider, externalId: previous.externalId };
        await tx.providerMappingOverride.upsert({
          where: { provider_externalId: old },
          create: { ...old, animeId: chosen, ignored: true },
          update: { animeId: chosen, ignored: true },
        });
      }
      await tx.animeProvider.upsert({
        where: { provider_externalId: mapping },
        create: { ...mapping, animeId: chosen },
        update: { animeId: chosen },
      });
    }
    await tx.providerMappingOverride.upsert({
      where: { provider_externalId: mapping },
      create: { ...mapping, animeId: chosen, ignored },
      update: { animeId: chosen, ignored },
    });
    await tx.providerMappingConflict.update({
      where: { id },
      data: {
        status: "resolved",
        decision,
        reason,
        resolvedBy: actorId,
        resolvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.auditEvent.create({
      data: {
        action: "catalog.mapping.resolve",
        objectId: id,
        actorId,
        reason: `${decision}: ${reason}`,
      },
    });
    return { ok: true };
  });
}
