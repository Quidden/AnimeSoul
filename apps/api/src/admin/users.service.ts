import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AdminUsersQuery,
  AdminUserRow,
  AdminUserEdit,
  AdminUserAccess,
  AdminJournalQuery,
} from "@animesoul/contracts";
import { administrativeRoles, managedPermissions } from "@animesoul/contracts";
import { Prisma, type DatabaseTransaction } from "@animesoul/database";
import { AuthService, uniqueConflict } from "../auth/auth.service.js";
import { setNativeAccess } from "../subscriptions/native-access.js";
import { operation, version, csv, type Write } from "./operations.js";

const accessInclude = {
  profile: true,
  roles: true,
  permissions: true,
  subscriptionTrial: true,
  entitlements: {
    where: { revokedAt: null },
    orderBy: { expiresAt: "desc" as const },
    include: { plan: true },
  },
};
@Injectable()
export class AdminUsersService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private row(
    user: NonNullable<Awaited<ReturnType<AdminUsersService["record"]>>>,
    launches = 0,
  ): AdminUserRow {
    const now = new Date(),
      trial = user.subscriptionTrial;
    const grant = user.entitlements.find((e) => e.expiresAt > now);
    const permission = user.permissions.some((p) => p.permission === "player.native");
    const trialActive =
      trial && !trial.revokedAt && trial.startedAt <= now && trial.expiresAt > now;
    return {
      id: user.id,
      username: user.profile?.username ?? "Без профиля",
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      disabledAt: user.disabledAt?.toISOString() ?? null,
      roles: user.roles.map((r) => r.role),
      permissions: user.permissions.map((p) => p.permission),
      version: user.adminVersion,
      launches,
      subscription: {
        status: user.disabledAt
          ? "disabled"
          : permission || grant
            ? "active"
            : trialActive
              ? "trial"
              : user.entitlements.length || trial
                ? "expired"
                : "none",
        source: permission ? "permission" : (grant?.source ?? (trialActive ? "trial" : "none")),
        planId: grant?.planId ?? null,
        planName: grant?.plan?.name ?? null,
        expiresAt: permission
          ? null
          : (grant?.expiresAt.toISOString() ??
            (trialActive ? trial!.expiresAt.toISOString() : null)),
      },
    };
  }
  private record(id: string) {
    return this.auth.db.user.findUnique({ where: { id }, include: accessInclude });
  }
  async list(q: AdminUsersQuery, exporting = false) {
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    const filters: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.q)
      filters.push(
        Prisma.sql`(lower(u.email) LIKE ${"%" + q.q.toLowerCase() + "%"} OR lower(p.username) LIKE ${"%" + q.q.toLowerCase() + "%"} OR u.id::text=${q.q})`,
      );
    if (q.role)
      filters.push(
        q.role === "member"
          ? Prisma.sql`NOT EXISTS(SELECT 1 FROM "UserRole" r WHERE r."userId"=u.id AND r.role IN('owner','admin'))`
          : Prisma.sql`EXISTS(SELECT 1 FROM "UserRole" r WHERE r."userId"=u.id AND r.role=${q.role})`,
      );
    if (q.permission)
      filters.push(
        Prisma.sql`EXISTS(SELECT 1 FROM "UserPermission" r WHERE r."userId"=u.id AND r.permission=${q.permission})`,
      );
    if (q.status)
      filters.push(
        q.status === "disabled"
          ? Prisma.sql`u."disabledAt" IS NOT NULL`
          : Prisma.sql`u."disabledAt" IS NULL`,
      );
    if (q.from) filters.push(Prisma.sql`u."createdAt">=${q.from}::date`);
    if (q.to) filters.push(Prisma.sql`u."createdAt"<${q.to}::date+1`);
    if (q.activity) {
      const days = { day: 1, week: 7, month: 30, inactive: 30 }[q.activity];
      filters.push(
        q.activity === "inactive"
          ? Prisma.sql`(u."lastActiveAt" IS NULL OR u."lastActiveAt"<now()-${days}*interval '1 day')`
          : Prisma.sql`u."lastActiveAt">=now()-${days}*interval '1 day'`,
      );
    }
    if (q.plan)
      filters.push(
        Prisma.sql`EXISTS(SELECT 1 FROM "Entitlement" a WHERE a."userId"=u.id AND a."planId"=${q.plan} AND a."revokedAt" IS NULL AND a."expiresAt">now())`,
      );
    if (q.subscription) filters.push(Prisma.sql`state.status=${q.subscription}`);
    if (q.minLaunches !== undefined)
      filters.push(Prisma.sql`COALESCE(l.launches,0)>=${q.minLaunches}`);
    if (q.maxLaunches !== undefined)
      filters.push(Prisma.sql`COALESCE(l.launches,0)<=${q.maxLaunches}`);
    const base = Prisma.sql`WITH launches AS (SELECT "userId",count(*)::int launches FROM "AnalyticsEvent" WHERE kind='player_start' AND "createdAt">=(${month + "-01"}::date::timestamp) AND "createdAt"<(${month + "-01"}::date+interval '1 month') GROUP BY "userId")
      SELECT u.id,u.email,p.username,u."createdAt",u."lastActiveAt",u."disabledAt",u."adminVersion" version,COALESCE(l.launches,0)::int launches,state.status,
        a.source,a."planId",a."expiresAt",plan.name "planName",t."expiresAt" "trialExpiresAt",permanent.active "permanent",
        ARRAY(SELECT r.role FROM "UserRole" r WHERE r."userId"=u.id ORDER BY r.role) roles,
        ARRAY(SELECT r.permission FROM "UserPermission" r WHERE r."userId"=u.id ORDER BY r.permission) permissions
      FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u.id LEFT JOIN launches l ON l."userId"=u.id LEFT JOIN "SubscriptionTrial" t ON t."userId"=u.id
      LEFT JOIN LATERAL (SELECT source,"planId","expiresAt" FROM "Entitlement" WHERE "userId"=u.id AND permission='player.native' AND "revokedAt" IS NULL AND "expiresAt">now() ORDER BY "expiresAt" DESC LIMIT 1) a ON true
      LEFT JOIN "SubscriptionPlan" plan ON plan.id=a."planId"
      CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM "UserPermission" r WHERE r."userId"=u.id AND r.permission='player.native') active) permanent
      CROSS JOIN LATERAL (SELECT CASE WHEN u."disabledAt" IS NOT NULL THEN 'disabled' WHEN permanent.active OR a."expiresAt" IS NOT NULL THEN 'active' WHEN t."revokedAt" IS NULL AND t."startedAt"<=now() AND t."expiresAt">now() THEN 'trial' WHEN t."userId" IS NOT NULL OR EXISTS(SELECT 1 FROM "Entitlement" e WHERE e."userId"=u.id) THEN 'expired' ELSE 'none' END status) state
      WHERE ${Prisma.join(filters, " AND ")}`;
    const [count] = await this.auth.db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int total FROM (${base}) filtered`,
    );
    const total = count?.total ?? 0;
    if (exporting && total > 10000)
      throw new BadRequestException("Сузьте выборку до 10 000 пользователей.");
    const sort = Prisma.raw('"' + q.sort + '"'),
      direction = Prisma.raw(q.direction.toUpperCase());
    type Row = {
      id: string;
      email: string | null;
      username: string | null;
      createdAt: Date;
      lastActiveAt: Date | null;
      disabledAt: Date | null;
      version: number;
      launches: number;
      status: string;
      source: string | null;
      planId: string | null;
      planName: string | null;
      expiresAt: Date | null;
      trialExpiresAt: Date | null;
      permanent: boolean;
      roles: string[];
      permissions: string[];
    };
    const rows = await this.auth.db.$queryRaw<Row[]>(
      Prisma.sql`SELECT * FROM (${base}) filtered ORDER BY ${sort} ${direction} NULLS LAST,id ASC LIMIT ${exporting ? 10000 : q.pageSize} OFFSET ${exporting ? 0 : (q.page - 1) * q.pageSize}`,
    );
    const items: AdminUserRow[] = rows.map((u) => ({
      id: u.id,
      username: u.username ?? "Без профиля",
      email: u.email,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      disabledAt: u.disabledAt?.toISOString() ?? null,
      version: u.version,
      launches: u.launches,
      roles: u.roles,
      permissions: u.permissions,
      subscription: {
        status: u.status,
        source: u.permanent
          ? "permission"
          : (u.source ?? (u.status === "trial" ? "trial" : "none")),
        planId: u.planId,
        planName: u.planName,
        expiresAt: u.permanent
          ? null
          : (u.expiresAt?.toISOString() ??
            (u.status === "trial" ? (u.trialExpiresAt?.toISOString() ?? null) : null)),
      },
    }));
    if (exporting)
      return csv([
        [
          "id",
          "username",
          "email",
          "roles",
          "permissions",
          "createdAt",
          "lastActiveAt",
          "blocked",
          "plan",
          "expiry",
          "launches",
          "month",
        ],
        ...items.map((u) => [
          u.id,
          u.username,
          u.email,
          u.roles.join(";"),
          u.permissions.join(";"),
          u.createdAt,
          u.lastActiveAt,
          u.disabledAt,
          u.subscription.planName,
          u.subscription.expiresAt,
          u.launches,
          month,
        ]),
      ]);
    return { items, total, page: q.page, pageSize: q.pageSize, month };
  }
  async detail(id: string) {
    const u = await this.record(id);
    if (!u) throw new NotFoundException("Пользователь не найден.");
    const [library, posts, comments, activeSessions, mfa, history, launches] = await Promise.all([
      this.auth.db.libraryItem.count({ where: { userId: id } }),
      this.auth.db.post.count({ where: { authorId: id, deletedAt: null } }),
      this.auth.db.comment.count({ where: { authorId: id, deletedAt: null } }),
      this.auth.db.session.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.auth.db.mfaCredential.findUnique({ where: { userId: id }, select: { enabledAt: true } }),
      this.auth.db.entitlement.findMany({
        where: { userId: id },
        orderBy: { expiresAt: "desc" },
        take: 100,
        select: {
          id: true,
          planId: true,
          source: true,
          permission: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          amountMinor: true,
          currency: true,
        },
      }),
      this.auth.db.analyticsEvent.count({
        where: {
          userId: id,
          kind: "player_start",
          createdAt: { gte: new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z") },
        },
      }),
    ]);
    const user = this.row(u, launches);
    return {
      user,
      about: u.profile?.about ?? "",
      mfaEnabled: Boolean(mfa?.enabledAt),
      emailVerified: Boolean(u.emailVerifiedAt),
      effectiveRights: user.disabledAt
        ? []
        : [
            ...new Set([
              ...user.permissions,
              ...(user.subscription.status === "active" || user.subscription.status === "trial"
                ? ["player.native"]
                : []),
              ...(user.roles.some((r) => ["owner", "admin"].includes(r))
                ? [
                    "Администрирование",
                    "Управление каталогом",
                    "Переключение Kodik",
                    ...(user.roles.includes("owner")
                      ? ["Назначение ролей и прав", "providers.yummy.manage"]
                      : []),
                  ]
                : []),
            ]),
          ],
      counts: { library, posts, comments, activeSessions },
      accessHistory: history,
      trial: u.subscriptionTrial
        ? {
            startedAt: u.subscriptionTrial.startedAt,
            expiresAt: u.subscriptionTrial.expiresAt,
            revokedAt: u.subscriptionTrial.revokedAt,
          }
        : null,
    };
  }
  private async editable(tx: DatabaseTransaction, actorId: string, id: string, owner: boolean) {
    const target = await tx.user.findUnique({
      where: { id },
      include: { roles: true, permissions: true, profile: true },
    });
    if (!target) throw new NotFoundException("Пользователь не найден.");
    if (id === actorId)
      throw new ForbiddenException(
        "Собственную учётную запись изменяйте через настройки аккаунта.",
      );
    if (!owner && target.roles.some((r) => ["owner", "admin"].includes(r.role)))
      throw new ForbiddenException("Административный аккаунт может изменить только владелец.");
    return target;
  }
  async edit(actorId: string, id: string, input: AdminUserEdit) {
    try {
      await operation(this.auth.db, actorId, "admin.user.updated", input, async (tx, owner) => {
        const u = await this.editable(tx, actorId, id, owner);
        version(u.adminVersion, input.version);
        if ((input.roles || input.permissions) && !owner)
          throw new ForbiddenException("Роли и постоянные разрешения меняет владелец.");
        const before = {
          username: u.profile?.username,
          disabled: Boolean(u.disabledAt),
          roles: u.roles.map((r) => r.role),
          permissions: u.permissions.map((p) => p.permission),
        };
        const roleChanged =
          input.roles !== undefined &&
          JSON.stringify([...input.roles].sort()) !==
            JSON.stringify(
              u.roles
                .map((r) => r.role)
                .filter((role) => (administrativeRoles as readonly string[]).includes(role))
                .sort(),
            );
        const permissionsChanged =
          input.permissions !== undefined &&
          JSON.stringify([...input.permissions].sort()) !==
            JSON.stringify(
              u.permissions
                .map((p) => p.permission)
                .filter((permission) =>
                  (managedPermissions as readonly string[]).includes(permission),
                )
                .sort(),
            );
        if (input.roles && roleChanged) {
          await tx.userRole.deleteMany({
            where: { userId: id, role: { in: [...administrativeRoles] } },
          });
          await tx.userRole.createMany({
            data: [...new Set(input.roles)].map((role) => ({ userId: id, role })),
            skipDuplicates: true,
          });
        }
        if (input.permissions && permissionsChanged) {
          await tx.userPermission.deleteMany({
            where: { userId: id, permission: { in: [...managedPermissions] } },
          });
          await tx.userPermission.createMany({
            data: [...new Set(input.permissions)].map((permission) => ({
              userId: id,
              permission,
              grantedBy: actorId,
            })),
            skipDuplicates: true,
          });
        }
        if (input.username !== undefined || input.about !== undefined) {
          if (!u.profile) throw new ConflictException("Профиль ещё не создан.");
          await tx.userProfile.update({
            where: { userId: id },
            data: {
              ...(input.username
                ? { username: input.username, usernameKey: input.username.toLowerCase() }
                : {}),
              ...(input.about !== undefined ? { about: input.about } : {}),
            },
          });
        }
        await tx.user.update({
          where: { id },
          data: {
            adminVersion: { increment: 1 },
            ...(input.disabled !== undefined
              ? { disabledAt: input.disabled ? new Date() : null }
              : {}),
          },
        });
        if (input.disabled || roleChanged || permissionsChanged)
          await tx.session.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        if (
          !(await tx.user.count({
            where: {
              disabledAt: null,
              roles: { some: { role: { in: [...administrativeRoles] } } },
            },
          }))
        )
          throw new ConflictException(
            "Нельзя лишить платформу последнего активного администратора.",
          );
        return {
          objectId: id,
          details: {
            before,
            after: {
              username: input.username ?? before.username,
              disabled: input.disabled ?? before.disabled,
              roles: input.roles ?? before.roles,
              permissions: input.permissions ?? before.permissions,
            },
            aboutChanged: input.about !== undefined,
          },
        };
      });
    } catch (error) {
      uniqueConflict(error);
    }
    return this.detail(id);
  }
  async access(actorId: string, id: string, input: AdminUserAccess) {
    if (input.enabled && (!input.expiresAt || new Date(input.expiresAt) <= new Date()))
      throw new BadRequestException("Укажите будущую дату.");
    await operation(
      this.auth.db,
      actorId,
      input.enabled ? "subscription.access.granted" : "subscription.access.revoked",
      input,
      async (tx, owner) => {
        const u = await this.editable(tx, actorId, id, owner);
        version(u.adminVersion, input.version);
        const plan = input.planId
          ? await tx.subscriptionPlan.findUnique({ where: { id: input.planId } })
          : null;
        if (
          input.enabled &&
          (!plan || !plan.enabled || !plan.permissions.includes("player.native"))
        )
          throw new BadRequestException("Выберите действующий тариф с доступом к плееру.");
        const revokedGrantIds = await setNativeAccess(
          tx,
          id,
          input.enabled,
          input.expiresAt ? new Date(input.expiresAt) : null,
          plan,
        );
        return {
          objectId: id,
          details: {
            before: {
              activeGrantIds: revokedGrantIds,
            },
            after: { enabled: input.enabled, planId: input.planId, expiresAt: input.expiresAt },
          },
        };
      },
    );
    return this.detail(id);
  }
  async bulk(actorId: string, input: Write & { ids: string[]; disabled: boolean }) {
    await operation(this.auth.db, actorId, "admin.users.status", input, async (tx, owner) => {
      const ids = [...new Set(input.ids)];
      for (const id of ids) await this.editable(tx, actorId, id, owner);
      await tx.user.updateMany({
        where: { id: { in: ids } },
        data: { disabledAt: input.disabled ? new Date() : null, adminVersion: { increment: 1 } },
      });
      if (input.disabled)
        await tx.session.updateMany({
          where: { userId: { in: ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      if (
        !(await tx.user.count({
          where: { disabledAt: null, roles: { some: { role: { in: [...administrativeRoles] } } } },
        }))
      )
        throw new ConflictException("Нужен хотя бы один активный администратор.");
      return { objectId: ids.join(","), details: { ids, disabled: input.disabled } };
    });
    return { updated: input.ids.length };
  }
  async journal(q: AdminJournalQuery, exporting = false) {
    const source = Prisma.sql`
      SELECT id,"actorId",action,"objectId",reason,details,"createdAt",CASE WHEN action ~ '^(admin\\.|subscription\\.|provider|catalog\\.)' OR action='session.login.admin' THEN 'admin' ELSE 'user' END AS category FROM "AuditEvent"
      UNION ALL SELECT id,"userId" AS "actorId",'analytics.'||kind AS action,"animeId"::text AS "objectId",NULL::text AS reason,
      jsonb_build_object('path',path,'feature',feature,'animeId',"animeId",'episodeId',"episodeId",'season',season,'episode',episode,'player',player) AS details,"createdAt",'user' AS category
      FROM "AnalyticsEvent" WHERE kind IN('page_view','player_start','feature')`;
    const filter = Prisma.sql`WHERE true
      ${q.category !== "all" ? Prisma.sql`AND e.category=${q.category}` : Prisma.empty}
      ${q.userId ? Prisma.sql`AND (e."actorId"=${q.userId}::uuid OR e."objectId"=${q.userId})` : Prisma.empty}
      ${q.actorId ? Prisma.sql`AND e."actorId"=${q.actorId}::uuid` : Prisma.empty}
      ${q.action ? Prisma.sql`AND e.action ILIKE ${"%" + q.action + "%"}` : Prisma.empty}
      ${q.q ? Prisma.sql`AND (e.action ILIKE ${"%" + q.q + "%"} OR e.reason ILIKE ${"%" + q.q + "%"} OR e."objectId" ILIKE ${"%" + q.q + "%"})` : Prisma.empty}
      ${q.from ? Prisma.sql`AND e."createdAt">=${q.from}::date` : Prisma.empty}
      ${q.to ? Prisma.sql`AND e."createdAt"<(${q.to}::date+1)` : Prisma.empty}`;
    const [count] = await this.auth.db.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int total FROM (${source}) e ${filter}`,
    );
    const total = count?.total ?? 0;
    if (exporting && total > 10000)
      throw new BadRequestException("Сузьте период до 10 000 событий.");
    const events = await this.auth.db.$queryRaw<
      {
        id: string;
        actorId: string | null;
        action: string;
        objectId: string | null;
        reason: string | null;
        details: unknown;
        createdAt: Date;
        category: string;
      }[]
    >(
      Prisma.sql`SELECT e.* FROM (${source}) e ${filter} ORDER BY e."createdAt" ${Prisma.raw(q.direction)},e.id ${Prisma.raw(q.direction)} LIMIT ${exporting ? 10000 : q.pageSize} OFFSET ${exporting ? 0 : (q.page - 1) * q.pageSize}`,
    );
    const actors = await this.auth.db.userProfile.findMany({
      where: {
        userId: { in: [...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : [])))] },
      },
      select: { userId: true, username: true },
    });
    const names = new Map(actors.map((a) => [a.userId, a.username]));
    const items = events.map((e) => ({
      id: e.id,
      time: e.createdAt.toISOString(),
      action: e.action,
      category: e.category,
      actorId: e.actorId,
      actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
      objectId: e.objectId,
      reason: e.reason,
      details: e.details,
      result: "success",
    }));
    if (exporting)
      return csv([
        ["time", "action", "actorId", "actorName", "objectId", "reason", "result"],
        ...items.map((e) => [
          e.time,
          e.action,
          e.actorId,
          e.actorName,
          e.objectId,
          e.reason,
          e.result,
        ]),
      ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
