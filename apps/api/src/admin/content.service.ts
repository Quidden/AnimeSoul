import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  winterSettingsSchema,
  type AnnouncementEdit,
  type NotificationEdit,
  type WinterSettings,
} from "@animesoul/contracts";
import type { DatabaseTransaction, Prisma } from "@animesoul/database";
import { AuthService } from "../auth/auth.service.js";
import { operation, version, type Write } from "./operations.js";
import {
  franchiseGraphLimit,
  resolveFranchise,
  type FranchiseGraphRow,
} from "../catalog/franchise.js";
type Message = AnnouncementEdit | NotificationEdit;
@Injectable()
export class AdministrationContentService {
  private graph: { time: number; rows: FranchiseGraphRow[] } | undefined;
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async list(kind: "announcements" | "notifications", page = 1, q = "", scope = "all") {
    const where = {
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { body: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const announcementWhere = {
      ...where,
      ...(scope === "anime"
        ? { scope: { in: ["season", "franchise"] } }
        : scope === "global"
          ? { scope: "global" }
          : {}),
    };
    const [items, total] =
      kind === "announcements"
        ? await Promise.all([
            this.auth.db.announcement.findMany({
              where: announcementWhere,
              include: { anime: { select: { title: true } } },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
            }),
            this.auth.db.announcement.count({ where: announcementWhere }),
          ])
        : await Promise.all([
            this.auth.db.notificationCampaign.findMany({
              where,
              include: { _count: { select: { receipts: true } } },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
            }),
            this.auth.db.notificationCampaign.count({ where }),
          ]);
    return {
      items: items.map((i) => ({
        ...i,
        animeTitle: "anime" in i ? i.anime?.title : null,
        readCount: "_count" in i ? i._count.receipts : undefined,
      })),
      total,
      page,
      pageSize: 25,
    };
  }
  async message(kind: "announcements" | "notifications", id: string) {
    const item =
      kind === "announcements"
        ? await this.auth.db.announcement.findUnique({
            where: { id },
            include: { anime: { select: { title: true } } },
          })
        : await this.auth.db.notificationCampaign.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    return { ...item, animeTitle: "anime" in item ? item.anime?.title : null };
  }
  async save(kind: "announcements" | "notifications", actorId: string, input: Message) {
    await operation(this.auth.db, actorId, `admin.${kind}.saved`, input, (tx) =>
      this.writeMessage(tx, kind, input),
    );
    return this.list(kind);
  }
  async writeMessage(
    tx: DatabaseTransaction,
    kind: "announcements" | "notifications",
    input: Message,
  ) {
    if (input.planId && !(await tx.subscriptionPlan.findUnique({ where: { id: input.planId } })))
      throw new BadRequestException("Тариф не найден.");
    if (
      input.userId &&
      !(await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } }))
    )
      throw new BadRequestException("Пользователь не найден.");
    const { id, operationId: _op, reason: _reason, version: expected, ...raw } = input;
    void _op;
    void _reason;
    const data = {
      ...raw,
      startsAt: new Date(raw.startsAt),
      endsAt: raw.endsAt ? new Date(raw.endsAt) : null,
    };
    let saved;
    let before: unknown;
    if (kind === "announcements") {
      const a = input as AnnouncementEdit;
      if (
        a.animeId &&
        !(await tx.anime.findFirst({
          where: { id: a.animeId, published: true },
          select: { id: true },
        }))
      )
        throw new BadRequestException("Аниме не найдено.");
      const existing = id ? await tx.announcement.findUnique({ where: { id } }) : null;
      if (id && !existing) throw new NotFoundException();
      if (existing) version(existing.version, expected);
      else if (expected !== 0) throw new BadRequestException();
      before = existing;
      const { userId: _user, ...announcement } = data as Omit<
        AnnouncementEdit,
        "id" | "operationId" | "reason" | "version"
      > & { startsAt: Date; endsAt: Date | null };
      void _user;
      saved = existing
        ? await tx.announcement.update({
            where: { id: id! },
            data: { ...announcement, version: { increment: 1 } },
          })
        : await tx.announcement.create({ data: announcement });
    } else {
      const existing = id ? await tx.notificationCampaign.findUnique({ where: { id } }) : null;
      if (id && !existing) throw new NotFoundException();
      if (existing) version(existing.version, expected);
      else if (expected !== 0) throw new BadRequestException();
      before = existing;
      saved = existing
        ? await tx.notificationCampaign.update({
            where: { id: id! },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.notificationCampaign.create({ data });
    }
    // Publication text can include private announcements; the audit retains configuration and changed-field names only.
    const safe = (v: unknown) => {
      if (!v || typeof v !== "object") return null;
      const r = v as Record<string, unknown>;
      return {
        enabled: r.enabled,
        audience: r.audience,
        role: r.role,
        planId: r.planId,
        scope: r.scope ?? null,
        animeId: r.animeId ?? null,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        version: r.version,
      };
    };
    return {
      objectId: saved.id,
      details: JSON.parse(
        JSON.stringify({
          before: safe(before),
          after: safe(saved),
          fields: ["title", "body", "kind", "audience", "window"],
        }),
      ) as Prisma.InputJsonValue,
    };
  }
  async winter() {
    const row = await this.auth.db.siteSetting.findUnique({ where: { key: "appearance.winter" } });
    return { settings: winterSettingsSchema.parse(row?.value ?? {}), version: row?.version ?? 0 };
  }
  async saveWinter(actorId: string, input: Write & { version: number; settings: WinterSettings }) {
    await operation(this.auth.db, actorId, "admin.appearance.winter", input, (tx) =>
      this.writeWinter(tx, input),
    );
    return this.winter();
  }
  async writeWinter(
    tx: DatabaseTransaction,
    input: Write & { version: number; settings: WinterSettings },
  ) {
    const row = await tx.siteSetting.findUnique({ where: { key: "appearance.winter" } });
    version(row?.version ?? 0, input.version);
    await tx.siteSetting.upsert({
      where: { key: "appearance.winter" },
      create: { key: "appearance.winter", value: input.settings, version: 1 },
      update: { value: input.settings, version: { increment: 1 } },
    });
    return {
      objectId: "appearance.winter",
      details: { before: row?.value ?? null, after: input.settings },
    };
  }
  private async audience(userId?: string) {
    if (!userId) return [{ audience: "all" }];
    const u = await this.auth.db.user.findUnique({
      where: { id: userId },
      select: {
        roles: { select: { role: true } },
        entitlements: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { planId: true },
        },
      },
    });
    return [
      { audience: "all" },
      { audience: "authenticated" },
      { audience: "role", role: { in: u?.roles.map((r) => r.role) ?? [] } },
      {
        audience: "subscription",
        planId: { in: u?.entitlements.flatMap((e) => (e.planId ? [e.planId] : [])) ?? [] },
      },
      { audience: "user", userId },
    ];
  }
  private published() {
    return {
      enabled: true,
      startsAt: { lte: new Date() },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    };
  }
  private publicMessage(m: {
    id: string;
    title: string;
    body: string;
    kind: string;
    link: string | null;
    updatedAt: Date;
    endsAt: Date | null;
    dismissible?: boolean;
  }) {
    return {
      id: m.id,
      title: m.title,
      body: m.body,
      kind: m.kind,
      link: m.link,
      dismissible: m.dismissible ?? true,
      updatedAt: m.updatedAt.toISOString(),
      expiresAt: m.endsAt?.toISOString() ?? null,
    };
  }
  async experience(userId?: string, animeId?: string) {
    const audience = (await this.audience(userId))
      .filter((a) => a.audience !== "user")
      .map((a) => {
        const { userId: _id, ...safe } = a as typeof a & { userId?: string };
        void _id;
        return safe;
      });
    let ids: string[] = [];
    if (animeId) {
      const hasFranchise = await this.auth.db.announcement.count({
        where: { ...this.published(), scope: "franchise" },
      });
      if (hasFranchise) {
        if (!this.graph || Date.now() - this.graph.time > 60000) {
          const rows = await this.auth.db.anime.findMany({
            where: { published: true },
            select: {
              id: true,
              published: true,
              isDevelopment: true,
              metadataProvider: true,
              details: true,
              providers: { select: { provider: true, externalId: true } },
            },
            take: franchiseGraphLimit + 1,
          });
          this.graph = { time: Date.now(), rows };
        }
        ids =
          resolveFranchise(this.graph.rows, animeId, this.auth.config.NODE_ENV === "production")
            ?.ids ?? [];
      }
    }
    const scopes: Prisma.AnnouncementWhereInput[] = [
      ...(!animeId ? [{ scope: "global" }] : []),
      ...(animeId
        ? [
            { scope: "season", animeId },
            ...(ids.length ? [{ scope: "franchise", animeId: { in: ids } }] : []),
          ]
        : []),
    ];
    const [messages, winter] = await Promise.all([
      this.auth.db.announcement.findMany({
        where: { ...this.published(), AND: [{ OR: audience }, { OR: scopes }] },
        orderBy: [{ priority: "desc" }, { startsAt: "desc" }, { id: "asc" }],
        take: 20,
      }),
      this.winter(),
    ]);
    return { announcements: messages.map((m) => this.publicMessage(m)), winter: winter.settings };
  }
  async inbox(userId: string, page = 1) {
    const audience = (await this.audience(userId)).filter((a) => a.audience !== "all");
    const where: Prisma.NotificationCampaignWhereInput = {
      ...this.published(),
      AND: [{ OR: audience }],
      receipts: { none: { userId, dismissedAt: { not: null } } },
    };
    const [messages, total, unread] = await Promise.all([
      this.auth.db.notificationCampaign.findMany({
        where,
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
        include: { receipts: { where: { userId }, select: { readAt: true } } },
      }),
      this.auth.db.notificationCampaign.count({ where }),
      this.auth.db.notificationCampaign.count({
        where: { ...where, receipts: { none: { userId } } },
      }),
    ]);
    return {
      items: messages.map((m) => ({ ...this.publicMessage(m), read: Boolean(m.receipts.length) })),
      total,
      unread,
      page,
      pageSize: 25,
    };
  }
  async read(userId: string, id: string, dismiss: boolean) {
    const audience = (await this.audience(userId)).filter((a) => a.audience !== "all");
    if (
      !(await this.auth.db.notificationCampaign.findFirst({
        where: { id, ...this.published(), AND: [{ OR: audience }] },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    await this.auth.db.notificationReceipt.upsert({
      where: { userId_campaignId: { userId, campaignId: id } },
      create: {
        userId,
        campaignId: id,
        readAt: new Date(),
        dismissedAt: dismiss ? new Date() : null,
      },
      update: { ...(dismiss ? { dismissedAt: new Date() } : {}) },
    });
    return this.inbox(userId);
  }
  async search(q: string) {
    if (!q.trim()) return { users: [], plans: [], announcements: [], anime: [] };
    const [users, plans, announcements, anime] = await Promise.all([
      this.auth.db.user.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { profile: { username: { contains: q, mode: "insensitive" } } },
          ],
        },
        take: 8,
        select: { id: true, email: true, profile: { select: { username: true } } },
      }),
      this.auth.db.subscriptionPlan.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { id: { contains: q } }] },
        take: 8,
        select: { id: true, name: true, enabled: true },
      }),
      this.auth.db.announcement.findMany({
        where: { title: { contains: q, mode: "insensitive" } },
        take: 8,
        select: { id: true, title: true, scope: true, enabled: true },
      }),
      this.auth.db.anime.findMany({
        where: { title: { contains: q, mode: "insensitive" } },
        take: 15,
        select: { id: true, title: true, slug: true, year: true },
      }),
    ]);
    return { users, plans, announcements, anime };
  }
}
