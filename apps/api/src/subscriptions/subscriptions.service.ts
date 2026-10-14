import { randomUUID } from "node:crypto";
import { Prisma, type DatabaseTransaction } from "@animesoul/database";
import { setNativeAccess } from "./native-access.js";
import { operation, version } from "../admin/operations.js";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  defaultSubscriptionPlans,
  nativePlayerPermission,
  developerRole,
  subscriptionAdminSchema,
  subscriptionSchema,
  subscriptionQuote,
  type nativeAccessEditSchema,
  type subscriptionPlanEditSchema,
  type subscriptionPromotionEditSchema,
} from "@animesoul/contracts";
import type { z } from "zod";
import { AuthService, cookieToken, type AuthRequest } from "../auth/auth.service.js";

export type SubscriptionViewer = string | { userId: string; sessionId: string };

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async viewer(request: AuthRequest) {
    if (!cookieToken(request, "web")) return undefined;
    try {
      const session = await this.auth.requireSession(request);
      return { userId: session.userId, sessionId: session.id };
    } catch (error) {
      if (error instanceof UnauthorizedException) return undefined;
      throw error;
    }
  }
  async access(viewer?: SubscriptionViewer, now = new Date()) {
    const empty = {
      nativeAccess: false,
      source: "none" as const,
      expiresAt: null,
      trialEndsAt: null,
      firstMonthDiscount: false,
    };
    if (!viewer || !this.auth.config.DATABASE_URL) return empty;
    const userId = typeof viewer === "string" ? viewer : viewer.userId;
    // Re-read this session before and after resolving files; a mode change must
    // cancel an in-flight privileged stream without changing the user's roles.
    const session =
      typeof viewer === "string"
        ? null
        : await this.auth.db.session.findUnique({
            where: { id: viewer.sessionId },
          });
    if (
      typeof viewer !== "string" &&
      (!session ||
        session.userId !== userId ||
        session.audience !== "web" ||
        session.revokedAt ||
        session.expiresAt <= now)
    )
      return empty;
    const user = await this.auth.db.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        permissions: { where: { permission: nativePlayerPermission } },
        subscriptionTrial: true,
        entitlements: {
          where: { permission: nativePlayerPermission, revokedAt: null, expiresAt: { gt: now } },
        },
      },
    });
    if (!user || user.disabledAt) return empty;
    if (developerRole(user.roles.map((value) => value.role))) {
      const mode = session?.developerAccessMode ?? "actual";
      if (mode === "guest" || mode === "user") return empty;
      if (mode === "trial" || mode === "subscriber") {
        const expiresAt = session!.expiresAt.toISOString();
        return {
          ...empty,
          nativeAccess: true,
          source: mode === "trial" ? ("trial" as const) : ("subscription" as const),
          expiresAt,
          trialEndsAt: mode === "trial" ? expiresAt : null,
        };
      }
      if (mode === "actual") return { ...empty, nativeAccess: true, source: "staff" as const };
      return empty;
    }
    const trial = user.subscriptionTrial;
    const trialEndsAt = trial?.expiresAt.toISOString() ?? null;
    // A trial is issued once at registration, never on login or for imported accounts.
    const firstMonthDiscount = Boolean(
      trial && !trial.revokedAt && !trial.discountRedeemedAt && trial.expiresAt <= now,
    );
    const shared = { trialEndsAt, firstMonthDiscount };
    if (user.permissions.length)
      return { ...shared, nativeAccess: true, source: "permission" as const, expiresAt: null };
    const grant = user.entitlements.sort(
      (a, b) => b.expiresAt.getTime() - a.expiresAt.getTime(),
    )[0];
    if (
      trial &&
      !trial.revokedAt &&
      trial.startedAt <= now &&
      trial.expiresAt > now &&
      (!grant || trial.expiresAt > grant.expiresAt)
    )
      return { ...shared, nativeAccess: true, source: "trial" as const, expiresAt: trialEndsAt };
    if (grant)
      return {
        ...shared,
        nativeAccess: true,
        source: grant.source === "admin" ? ("permission" as const) : ("subscription" as const),
        expiresAt: grant.expiresAt.toISOString(),
      };
    return { ...empty, ...shared };
  }
  async catalog() {
    if (!this.auth.config.DATABASE_URL) return { plans: defaultSubscriptionPlans, promotions: [] };
    const [plans, promotions] = await Promise.all([
      this.auth.db.subscriptionPlan.findMany({
        orderBy: [{ sortOrder: "asc" }, { months: "asc" }, { id: "asc" }],
        take: 24,
      }),
      this.auth.db.subscriptionPromotion.findMany({ orderBy: { startsAt: "desc" }, take: 100 }),
    ]);
    return subscriptionAdminSchema.parse({
      plans,
      promotions: promotions.map((p) => ({
        ...p,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
      })),
    });
  }
  async status(userId?: SubscriptionViewer) {
    const now = new Date();
    const [access, catalog] = await Promise.all([this.access(userId, now), this.catalog()]);
    // A long-running active offer must survive an archive of more than 100 newer offers.
    const promotions = this.auth.config.DATABASE_URL
      ? await this.auth.db.$queryRaw<
          {
            id: string;
            name: string;
            description: string;
            planIds: string[];
            percent: number;
            months: number[];
            startsAt: Date;
            endsAt: Date;
            enabled: boolean;
            version: number;
          }[]
        >(Prisma.sql`
      SELECT DISTINCT offer.* FROM "SubscriptionPlan" p CROSS JOIN LATERAL (
        SELECT o.* FROM "SubscriptionPromotion" o WHERE o.enabled AND o."startsAt"<=${now} AND o."endsAt">${now}
        AND (cardinality(o.months)=0 OR p.months=ANY(o.months)) AND (cardinality(o."planIds")=0 OR p.id=ANY(o."planIds"))
        ORDER BY o.percent DESC,o.id ASC LIMIT 1
      ) offer WHERE p.enabled`)
      : [];
    return subscriptionSchema.parse({
      authenticated: Boolean(userId),
      ...access,
      directEnabled:
        this.auth.config.ALLOW_KODIK_DIRECT === "true" &&
        Boolean(this.auth.config.KODIK_PRIVATE_KEY),
      billingAvailable: false,
      plans: catalog.plans
        .filter((p) => p.enabled && p.permissions.includes(nativePlayerPermission))
        .map((p) =>
          subscriptionQuote(
            p,
            promotions.map((o) => ({
              ...o,
              startsAt: o.startsAt.toISOString(),
              endsAt: o.endsAt.toISOString(),
            })),
            access.firstMonthDiscount,
            now,
          ),
        ),
    });
  }
  async plan(actorId: string, input: z.infer<typeof subscriptionPlanEditSchema>) {
    await operation(
      this.auth.db,
      actorId,
      input.create ? "subscription.plan.created" : "subscription.plan.updated",
      { ...input, operationId: input.operationId ?? randomUUID() },
      (tx) => this.writePlan(tx, input),
    );
    return this.catalog();
  }
  async writePlan(tx: DatabaseTransaction, input: z.infer<typeof subscriptionPlanEditSchema>) {
    const {
      reason,
      operationId = randomUUID(),
      create = false,
      version: expected,
      ...data
    } = input;
    void reason;
    void operationId;

    const old = await tx.subscriptionPlan.findUnique({ where: { id: data.id } });
    if (create && old) throw new BadRequestException("Этот идентификатор тарифа уже занят.");
    if (!create && !old) throw new NotFoundException("Тариф не найден.");
    if (old) version(old.version, expected);
    if (create && (await tx.subscriptionPlan.count()) >= 24)
      throw new BadRequestException("Поддерживается до 24 тарифов.");
    const saved = old
      ? await tx.subscriptionPlan.update({
          where: { id: data.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.subscriptionPlan.create({ data });
    return {
      objectId: data.id,
      details: JSON.parse(JSON.stringify({ before: old, after: saved })) as Prisma.InputJsonValue,
    };
  }
  async promotion(actorId: string, input: z.infer<typeof subscriptionPromotionEditSchema>) {
    await operation(
      this.auth.db,
      actorId,
      "subscription.promotion.updated",
      { ...input, operationId: input.operationId ?? randomUUID() },
      (tx) => this.writePromotion(tx, input),
    );
    return this.catalog();
  }
  async writePromotion(
    tx: DatabaseTransaction,
    input: z.infer<typeof subscriptionPromotionEditSchema>,
  ) {
    const { reason, operationId = randomUUID(), id, version: expected, ...values } = input;
    const data = {
      ...values,
      months: [...new Set(values.months)],
      planIds: [...new Set(values.planIds)],
      startsAt: new Date(values.startsAt),
      endsAt: new Date(values.endsAt),
    };
    void reason;
    void operationId;

    if (
      data.planIds.length !==
      (await tx.subscriptionPlan.count({ where: { id: { in: data.planIds } } }))
    )
      throw new BadRequestException("Один из тарифов не существует.");
    const old = id ? await tx.subscriptionPromotion.findUnique({ where: { id } }) : null;
    if (id && !old) throw new NotFoundException("Акция не найдена.");
    if (old) version(old.version, expected);
    const saved = old
      ? await tx.subscriptionPromotion.update({
          where: { id: old.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.subscriptionPromotion.create({ data });
    return {
      objectId: saved.id,
      details: JSON.parse(JSON.stringify({ before: old, after: saved })) as Prisma.InputJsonValue,
    };
  }
  async userId(username: string) {
    const profile = await this.auth.db.userProfile.findUnique({
      where: { usernameKey: username.trim().toLowerCase() },
      select: { userId: true },
    });
    if (!profile) throw new NotFoundException("Пользователь не найден.");
    return profile.userId;
  }
  async grant(actorId: string, input: z.infer<typeof nativeAccessEditSchema>) {
    const now = new Date(),
      expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (input.enabled && (!expiresAt || expiresAt <= now))
      throw new BadRequestException("Укажите будущую дату окончания доступа.");
    const userId = await this.userId(input.username);
    if (userId === actorId)
      throw new BadRequestException("Нельзя изменять собственный доступ через админку.");
    await operation(
      this.auth.db,
      actorId,
      input.enabled ? "subscription.access.granted" : "subscription.access.revoked",
      { ...input, operationId: randomUUID() },
      async (tx, owner) => {
        const target = await tx.user.findUnique({
          where: { id: userId },
          include: { roles: true },
        });
        if (!owner && target?.roles.some((r) => ["owner", "admin"].includes(r.role)))
          throw new BadRequestException("Административный аккаунт изменяет владелец.");
        await setNativeAccess(tx, userId, input.enabled, expiresAt);
        return {
          objectId: userId,
          details: { enabled: input.enabled, expiresAt: input.expiresAt },
        };
      },
    );
    return this.status(userId);
  }
}
