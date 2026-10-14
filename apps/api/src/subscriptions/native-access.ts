import { BadRequestException } from "@nestjs/common";
import { nativePlayerPermission } from "@animesoul/contracts";
import type { DatabaseTransaction } from "@animesoul/database";

/** Both administrative entry points use the existing native entitlement lifecycle. */
export async function setNativeAccess(
  tx: DatabaseTransaction,
  userId: string,
  enabled: boolean,
  expiresAt: Date | null,
  plan: { id: string; amountMinor: number | null; currency: string } | null = null,
) {
  const now = new Date();
  if (enabled && (!expiresAt || expiresAt <= now))
    throw new BadRequestException("Укажите будущую дату окончания доступа.");
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId}::uuid FOR UPDATE`;
  const where = {
    userId,
    permission: nativePlayerPermission,
    revokedAt: null,
    ...(enabled ? { source: "admin" } : {}),
  };
  const previous = await tx.entitlement.findMany({ where, select: { id: true } });
  await tx.entitlement.updateMany({ where, data: { revokedAt: now } });
  if (enabled) {
    await tx.entitlement.create({
      data: {
        userId,
        permission: nativePlayerPermission,
        source: "admin",
        expiresAt: expiresAt!,
        createdAt: now,
        ...(plan
          ? { planId: plan.id, amountMinor: plan.amountMinor, currency: plan.currency }
          : {}),
      },
    });
  } else {
    await tx.userPermission.deleteMany({ where: { userId, permission: nativePlayerPermission } });
    await tx.subscriptionTrial.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  await tx.user.update({ where: { id: userId }, data: { adminVersion: { increment: 1 } } });
  return previous.map((grant) => grant.id);
}
