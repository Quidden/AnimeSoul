import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Database } from "@animesoul/database";
export const reservePermission = "providers.yummy.manage";
export function providerAccess(user: {
  roles: { role: string }[];
  permissions: { permission: string }[];
}) {
  const owner = user.roles.some((r) => r.role === "owner"),
    admin = owner || user.roles.some((r) => r.role === "admin");
  return {
    canSwitchKodik: admin,
    canSwitchReserve: owner || user.permissions.some((p) => p.permission === reservePermission),
    canManageCatalog: admin,
    canDelegateReserve: owner,
  };
}
/** Owners delegate a site-wide control, never a per-viewer playback preference. */
export async function grantReserveAccess(
  database: Database,
  actorId: string,
  username: string,
  enabled: boolean,
  reason: string,
) {
  if (reason.trim().length < 3 || reason.length > 500)
    throw new BadRequestException("A reason is required.");
  return database.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(1095978060)");
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(731006, 5)");
    const actor = await tx.user.findUnique({ where: { id: actorId }, include: { roles: true } });
    if (!actor || actor.disabledAt || !actor.roles.some((r) => r.role === "owner"))
      throw new ForbiddenException();
    const target = await tx.user.findFirst({
      where: {
        profile: { usernameKey: username.toLocaleLowerCase() },
        disabledAt: null,
        email: { not: null },
        passwordHash: { not: null },
      },
      include: { roles: true },
    });
    if (!target) throw new ConflictException("An active registered account is required.");
    if (target.roles.some((r) => r.role === "owner"))
      throw new ConflictException("Owners already have this permission.");
    if (enabled)
      await tx.userPermission.upsert({
        where: { userId_permission: { userId: target.id, permission: reservePermission } },
        create: { userId: target.id, permission: reservePermission, grantedBy: actorId },
        update: {},
      });
    else
      await tx.userPermission.deleteMany({
        where: { userId: target.id, permission: reservePermission },
      });
    await tx.session.updateMany({
      where: { userId: target.id, audience: "admin", revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditEvent.create({
      // Changing delegated access invalidates concurrently opened user editors.
      data: {
        actorId,
        objectId: target.id,
        action: enabled ? "provider.reserve-access.grant" : "provider.reserve-access.revoke",
        reason,
      },
    });
    await tx.user.update({ where: { id: target.id }, data: { adminVersion: { increment: 1 } } });
    return { ok: true };
  });
}
