import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@animesoul/database";
import type {
  AnalyticsInput,
  AnalyticsQuery,
  AnalyticsBucket,
  AnalyticsSummary,
  AnalyticsReport,
  FrameSearchQuota,
} from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { digest } from "../auth/security.js";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";
import { csv } from "./operations.js";
export function analyticsRange(q: AnalyticsQuery, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: q.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const days = q.period === "today" ? 1 : q.period === "custom" ? 1 : Number(q.period);
  const to = q.period === "custom" ? q.to! : today;
  const from =
    q.period === "custom"
      ? q.from!
      : new Date(new Date(to).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const length = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
  if (length < 1 || length > 366)
    throw new BadRequestException("Выберите период от 1 до 366 дней.");
  return {
    from,
    to,
    previousFrom: new Date(new Date(from).getTime() - length * 86400000).toISOString().slice(0, 10),
    previousTo: new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10),
  };
}
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}
  async quota(value: FrameSearchQuota) {
    if (!this.auth.config.DATABASE_URL) return;
    const hash = digest(
      ["trace.moe", Math.floor(Date.now() / 60000), value.total, value.used].join(":"),
    );
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    await this.auth.db.analyticsEvent.createMany({
      data: [
        {
          id,
          visitorId: digest("server-quota"),
          visitId: "00000000-0000-4000-8000-000000000001",
          kind: "quota",
          feature: "trace.moe",
          value: value.used,
          limit: value.total,
        },
      ],
      skipDuplicates: true,
    });
    return id;
  }
  async collect(request: AuthRequest, input: AnalyticsInput) {
    this.auth.origin(request);
    const viewer = await this.subscriptions.viewer(request);
    const userId = viewer?.userId;
    if (input.kind === "player_start") {
      const anime = await this.auth.db.anime.findFirst({
        where: {
          id: input.animeId!,
          published: true,
          ...(this.auth.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
        },
        select: { id: true },
      });
      if (!anime) throw new NotFoundException();
      if (
        input.episodeId &&
        !(await this.auth.db.episode.findFirst({
          where: { id: input.episodeId, animeId: input.animeId! },
          select: { id: true },
        }))
      )
        throw new BadRequestException("Эпизод не принадлежит аниме.");
      if (input.player === "native" && !(await this.subscriptions.access(viewer)).nativeAccess)
        throw new BadRequestException("Нет доступа к этому плееру.");
    }
    await this.auth.db.$transaction(async (tx) => {
      const inserted = await tx.analyticsEvent.createMany({
        data: [
          {
            id: input.id,
            userId: userId ?? null,
            visitorId: digest(input.visitorId),
            visitId: input.visitId,
            kind: input.kind,
            path: input.path ?? null,
            feature: input.feature ?? null,
            animeId: input.animeId ?? null,
            episodeId: input.episodeId ?? null,
            season: input.season ?? null,
            episode: input.episode ?? null,
            player: input.player ?? null,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count && userId)
        await tx.user.updateMany({ where: { id: userId }, data: { lastActiveAt: new Date() } });
    });
    return { accepted: true };
  }
  private bounds(from: string, to: string, timezone: string) {
    return {
      start: Prisma.sql`(${from}::date::timestamp AT TIME ZONE ${timezone} AT TIME ZONE 'UTC')`,
      end: Prisma.sql`LEAST(((${to}::date+1)::timestamp AT TIME ZONE ${timezone} AT TIME ZONE 'UTC'),now() AT TIME ZONE 'UTC')`,
    };
  }
  private filter(q: AnalyticsQuery) {
    return Prisma.sql`${q.userId ? Prisma.sql`AND e."userId"=${q.userId}::uuid` : Prisma.empty} ${q.animeId ? Prisma.sql`AND e."animeId"=${q.animeId}::uuid` : Prisma.empty}`;
  }
  private features(q: AnalyticsQuery) {
    return Prisma.sql`SELECT e.feature AS name,e."createdAt" AS time FROM "AnalyticsEvent" e WHERE kind='feature' ${this.filter(q)}
      UNION ALL SELECT CASE WHEN action LIKE 'profile.%' THEN 'profile.edit' WHEN action LIKE 'social.%' THEN 'social.action' WHEN action LIKE 'library.%' THEN 'library.edit' ELSE 'community.publish' END AS name,"createdAt" AS time
      FROM "AuditEvent" WHERE (action LIKE 'profile.%' OR action LIKE 'social.%' OR action LIKE 'library.%' OR action IN('post.created','comment.created'))
      ${q.userId ? Prisma.sql`AND "actorId"=${q.userId}::uuid` : Prisma.empty} ${q.animeId ? Prisma.sql`AND false` : Prisma.empty}`;
  }
  private activities(q: AnalyticsQuery, start: Prisma.Sql, end: Prisma.Sql) {
    return Prisma.sql`SELECT e."userId",e."createdAt" FROM "AnalyticsEvent" e WHERE e."userId" IS NOT NULL AND e."createdAt">=${start} AND e."createdAt"<${end} ${this.filter(q)}
      UNION ALL SELECT "actorId" AS "userId","createdAt" FROM "AuditEvent" WHERE "actorId" IS NOT NULL AND "createdAt">=${start} AND "createdAt"<${end}
      AND (action='session.login.web' OR action='account.registered' OR action LIKE 'profile.%' OR action LIKE 'library.%' OR action LIKE 'social.%' OR action IN('post.created','comment.created'))
      ${q.userId ? Prisma.sql`AND "actorId"=${q.userId}::uuid` : Prisma.empty} ${q.animeId ? Prisma.sql`AND false` : Prisma.empty}`;
  }
  private async summary(q: AnalyticsQuery, from: string, to: string): Promise<AnalyticsSummary> {
    const { start, end } = this.bounds(from, to, q.timezone),
      filter = this.filter(q);
    const [row] = await this.auth.db.$queryRaw<AnalyticsSummary[]>(Prisma.sql`
      SELECT (SELECT count(*)::int FROM "User" WHERE "createdAt"<${end} ${q.userId ? Prisma.sql`AND id=${q.userId}::uuid` : Prisma.empty}) AS "totalUsers",
      (SELECT count(*)::int FROM "User" WHERE "createdAt">=${start} AND "createdAt"<${end} ${q.userId ? Prisma.sql`AND id=${q.userId}::uuid` : Prisma.empty}) AS registrations,
      count(*) FILTER(WHERE e.kind='page_view')::int AS "pageViews",count(DISTINCT e."visitId") FILTER(WHERE e.kind='page_view')::int AS visits,
      count(DISTINCT e."visitorId") FILTER(WHERE e.kind='page_view')::int AS visitors,count(*) FILTER(WHERE e.kind='player_start')::int AS launches,
      count(DISTINCT COALESCE(e."userId"::text,e."visitorId")) FILTER(WHERE e.kind='player_start')::int AS "launchUsers",
      0::float AS "averageLaunches",0::int AS dau,0::int AS wau,0::int AS mau,0::int AS "activeSubscribers",0::int AS trials,0::int AS "nativePermissions"
      FROM "AnalyticsEvent" e WHERE e."createdAt">=${start} AND e."createdAt"<${end} ${filter}`);
    const [activity] = await this.auth.db.$queryRaw<
      { dau: number; wau: number; mau: number }[]
    >(Prisma.sql`
      SELECT count(DISTINCT e."userId") FILTER(WHERE e."createdAt">=${end}-interval '1 day')::int AS dau,
      count(DISTINCT e."userId") FILTER(WHERE e."createdAt">=${end}-interval '7 days')::int AS wau,count(DISTINCT e."userId")::int AS mau
      FROM (${this.activities(q, Prisma.sql`${end}-interval '30 days'`, end)}) e`);
    const [access] = await this.auth.db.$queryRaw<
      { activeSubscribers: number; trials: number; nativePermissions: number }[]
    >(Prisma.sql`
      SELECT (SELECT count(DISTINCT "userId")::int FROM "Entitlement" WHERE "expiresAt">=now() ${q.userId ? Prisma.sql`AND "userId"=${q.userId}::uuid` : Prisma.empty} AND ("revokedAt" IS NULL OR "revokedAt">=now()) AND "permission"='player.native' AND ("createdAt"<now() OR "createdAt" IS NULL) AND EXISTS(SELECT 1 FROM "User" u WHERE u.id="Entitlement"."userId" AND u."disabledAt" IS NULL)) AS "activeSubscribers",
      (SELECT count(*)::int FROM "SubscriptionTrial" WHERE "startedAt"<now() ${q.userId ? Prisma.sql`AND "userId"=${q.userId}::uuid` : Prisma.empty} AND "expiresAt">=now() AND ("revokedAt" IS NULL OR "revokedAt">=now()) AND EXISTS(SELECT 1 FROM "User" u WHERE u.id="SubscriptionTrial"."userId" AND u."disabledAt" IS NULL)) AS trials,
      (SELECT count(*)::int FROM "UserPermission" p JOIN "User" u ON u.id=p."userId" WHERE p.permission='player.native' ${q.userId ? Prisma.sql`AND p."userId"=${q.userId}::uuid` : Prisma.empty} AND p."createdAt"<now() AND u."disabledAt" IS NULL) AS "nativePermissions"`);
    if (!row || !activity || !access) throw new Error("Analytics aggregation failed");
    return {
      ...row,
      ...activity,
      ...access,
      averageLaunches: row.launchUsers ? row.launches / row.launchUsers : 0,
    };
  }
  private async buckets(q: AnalyticsQuery, from: string, to: string): Promise<AnalyticsBucket[]> {
    const { start, end } = this.bounds(from, to, q.timezone),
      filter = this.filter(q);
    return this.auth.db.$queryRaw<AnalyticsBucket[]>(Prisma.sql`
      WITH dates AS (SELECT generate_series(date_trunc(${q.group},${from}::date),${to}::date,('1 '||${q.group})::interval)::date AS bucket),
      events AS (SELECT date_trunc(${q.group},e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date AS bucket,
        count(*) FILTER(WHERE kind='page_view')::int "pageViews",count(DISTINCT "visitId") FILTER(WHERE kind='page_view')::int visits,count(DISTINCT "visitorId") FILTER(WHERE kind='page_view')::int visitors,
        count(*) FILTER(WHERE kind='player_start')::int launches,count(DISTINCT COALESCE("userId"::text,"visitorId")) FILTER(WHERE kind='player_start')::int "launchUsers",count(*) FILTER(WHERE kind='feature')::int features
        FROM "AnalyticsEvent" e WHERE "createdAt">=${start} AND "createdAt"<${end} ${filter} GROUP BY 1),
      registrations AS (SELECT date_trunc(${q.group},"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date AS bucket,count(*)::int registrations FROM "User" WHERE "createdAt">=${start} AND "createdAt"<${end} ${q.userId ? Prisma.sql`AND id=${q.userId}::uuid` : Prisma.empty} GROUP BY 1),
      feature_counts AS (SELECT date_trunc(${q.group},time AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date AS bucket,count(*)::int total FROM (${this.features(q)}) f WHERE time>=${start} AND time<${end} GROUP BY 1),
      activity_counts AS (SELECT date_trunc(${q.group},"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date AS bucket,count(DISTINCT "userId")::int "activeUsers" FROM (${this.activities(q, start, end)}) a GROUP BY 1)
      SELECT dates.bucket::text date,COALESCE("pageViews",0) "pageViews",COALESCE(visits,0) visits,COALESCE(visitors,0) visitors,COALESCE("activeUsers",0) "activeUsers",COALESCE(launches,0) launches,COALESCE("launchUsers",0) "launchUsers",COALESCE(feature_counts.total,0) features,COALESCE(registrations.registrations,0) registrations
      FROM dates LEFT JOIN events USING(bucket) LEFT JOIN registrations USING(bucket) LEFT JOIN feature_counts USING(bucket) LEFT JOIN activity_counts USING(bucket) ORDER BY bucket`);
  }
  async report(q: AnalyticsQuery): Promise<AnalyticsReport> {
    const range = analyticsRange(q),
      { start, end } = this.bounds(range.from, range.to, q.timezone),
      previous = this.bounds(range.previousFrom, range.previousTo, q.timezone);
    const [
      current,
      prev,
      buckets,
      previousBuckets,
      features,
      subscriptions,
      setting,
      featureBuckets,
      quotaHistory,
    ] = await Promise.all([
      this.summary(q, range.from, range.to),
      this.summary(q, range.previousFrom, range.previousTo),
      this.buckets(q, range.from, range.to),
      this.buckets(q, range.previousFrom, range.previousTo),
      this.auth.db.$queryRaw<{ name: string; total: number; previous: number }[]>(
        Prisma.sql`SELECT name,count(*) FILTER(WHERE time>=${start})::int total,count(*) FILTER(WHERE time<${start})::int previous FROM (${this.features(q)}) f WHERE time>=${previous.start} AND time<${end} GROUP BY name ORDER BY total DESC`,
      ),
      this.auth.db.$queryRaw<{ id: string; name: string; users: number }[]>(
        Prisma.sql`SELECT p.id,p.name,count(DISTINCT e."userId")::int users FROM "SubscriptionPlan" p LEFT JOIN "Entitlement" e ON e."planId"=p.id AND e."expiresAt">now() AND e."revokedAt" IS NULL LEFT JOIN "User" u ON u.id=e."userId" WHERE u."disabledAt" IS NULL ${q.userId ? Prisma.sql`AND (e."userId"=${q.userId}::uuid OR e."userId" IS NULL)` : Prisma.empty} GROUP BY p.id,p.name ORDER BY p."sortOrder",p.id`,
      ),
      this.auth.db.siteSetting.findUnique({
        where: { key: "analytics.startedAt" },
        select: { value: true },
      }),
      this.auth.db.$queryRaw<{ name: string; date: string; value: number; current: boolean }[]>(
        Prisma.sql`SELECT name,date_trunc(${q.group},time AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date::text date,count(*)::int value,(time>=${start}) AS current FROM (${this.features(q)}) f WHERE time>=${previous.start} AND time<${end} GROUP BY name,2,4 ORDER BY 2`,
      ),
      this.auth.db.$queryRaw<{ date: string; used: number; total: number }[]>(
        Prisma.sql`SELECT DISTINCT ON(bucket) bucket::text date,value used,"limit" total FROM (SELECT date_trunc(${q.group},"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${q.timezone})::date bucket,"createdAt",value,"limit" FROM "AnalyticsEvent" WHERE kind='quota' AND feature='trace.moe' AND "createdAt">=${start} AND "createdAt"<${end} AND value IS NOT NULL AND "limit" IS NOT NULL) q ORDER BY bucket,"createdAt" DESC`,
      ),
    ]);
    return {
      from: range.from,
      to: range.to,
      timezone: q.timezone,
      group: q.group,
      collectedSince: typeof setting?.value === "string" ? setting.value : null,
      current,
      previous: prev,
      buckets,
      previousBuckets,
      features: features.map((f) => ({
        ...f,
        buckets: featureBuckets
          .filter((b) => b.name === f.name && b.current)
          .map(({ date, value }) => ({ date, value })),
        previousBuckets: featureBuckets
          .filter((b) => b.name === f.name && !b.current)
          .map(({ date, value }) => ({ date, value })),
      })),
      subscriptions,
      quotaHistory,
    };
  }
  async export(q: AnalyticsQuery) {
    const report = await this.report(q);
    return csv([
      [
        "date",
        "timezone",
        "pageViews",
        "visits",
        "visitors",
        "activeUsers",
        "launches",
        "launchUsers",
        "registrations",
        "features",
        "traceMoeUsed",
        "traceMoeTotal",
        ...report.features.map((f) => f.name),
      ],
      ...report.buckets.map((b) => [
        b.date,
        q.timezone,
        b.pageViews,
        b.visits,
        b.visitors,
        b.activeUsers,
        b.launches,
        b.launchUsers,
        b.registrations,
        b.features,
        report.quotaHistory.find((q) => q.date === b.date)?.used ?? "",
        report.quotaHistory.find((q) => q.date === b.date)?.total ?? "",
        ...report.features.map((f) => f.buckets.find((item) => item.date === b.date)?.value ?? 0),
      ]),
    ]);
  }
}
