import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import {
  adminUsersQuerySchema,
  adminUserEditSchema,
  adminUserAccessSchema,
  adminBulkUsersSchema,
  adminJournalQuerySchema,
  analyticsQuerySchema,
  analyticsEventSchema,
  announcementEditSchema,
  notificationEditSchema,
  winterEditSchema,
  adminPageSchema,
  profileMediaLimits,
  maintenanceEditSchema,
  adminTemplateEditSchema,
  adminTemplatePublishSchema,
  adminWriteSchema,
  adminPostPinSchema,
  templateKinds,
} from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { parse } from "../auth/auth.controller.js";
import { AdminUsersService } from "./users.service.js";
import { AnalyticsService } from "./analytics.service.js";
import { AdministrationContentService } from "./content.service.js";
import { ProvidersService } from "../providers/providers.service.js";
import { readDiagnostics } from "@animesoul/diagnostics";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";
import { AvailabilityService } from "./availability.service.js";
import { AdminTemplatesService } from "./templates.service.js";
const idSchema = z.uuid();
@Controller("api/admin/platform")
export class AdminPlatformController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(AdministrationContentService) private readonly content: AdministrationContentService,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AdminTemplatesService) private readonly templates: AdminTemplatesService,
  ) {}
  @Get("users") async list(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    return this.users.list(parse(adminUsersQuerySchema, query));
  }
  @Get("users.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=users.csv")
  async usersCsv(@Req() req: AuthRequest, @Query() query: unknown) {
    const actor = await this.auth.requireSession(req, "admin");
    const value = await this.users.list(parse(adminUsersQuerySchema, query), true);
    await this.exported(actor.userId, "users");
    return value;
  }
  @Get("users/:id") async detail(@Req() req: AuthRequest, @Param("id") id: string) {
    await this.auth.requireSession(req, "admin");
    return this.users.detail(parse(idSchema, id));
  }
  @Post("users/:id") async edit(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.auth.writeSession(req, "admin");
    return this.users.edit(a.userId, parse(idSchema, id), parse(adminUserEditSchema, body));
  }
  @Post("users/:id/access") async access(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.auth.writeSession(req, "admin");
    return this.users.access(a.userId, parse(idSchema, id), parse(adminUserAccessSchema, body));
  }
  @Post("users-bulk") async bulk(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.users.bulk(a.userId, parse(adminBulkUsersSchema, body));
  }
  @Get("journal") async journal(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    return this.users.journal(parse(adminJournalQuerySchema, query));
  }
  @Get("journal.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=journal.csv")
  async journalCsv(@Req() req: AuthRequest, @Query() query: unknown) {
    const actor = await this.auth.requireSession(req, "admin");
    const value = await this.users.journal(parse(adminJournalQuerySchema, query), true);
    await this.exported(actor.userId, "journal");
    return value;
  }
  @Get("analytics") async report(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    return this.analytics.report(parse(analyticsQuerySchema, query));
  }
  @Get("analytics.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=analytics.csv")
  async reportCsv(@Req() req: AuthRequest, @Query() query: unknown) {
    const actor = await this.auth.requireSession(req, "admin");
    const value = await this.analytics.export(parse(analyticsQuerySchema, query));
    await this.exported(actor.userId, "analytics");
    return value;
  }
  private exported(actorId: string, objectId: string) {
    return this.auth.db.auditEvent.create({
      data: {
        actorId,
        objectId,
        action: "admin.export",
        details: { format: "csv", maximumRows: 10000 },
      },
    });
  }
  @Get("announcements") async announcements(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    const q = parse(
      adminPageSchema.extend({ scope: z.enum(["all", "global", "anime"]).default("all") }),
      query,
    );
    return this.content.list("announcements", q.page, q.q, q.scope);
  }
  @Post("community/posts/:id/pin") async pinPost(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.auth.writeSession(req, "admin");
    return this.content.pinPost(actor.userId, parse(idSchema, id), parse(adminPostPinSchema, body));
  }
  @Get("notifications") async notifications(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    const q = parse(adminPageSchema, query);
    return this.content.list("notifications", q.page, q.q);
  }
  @Get("announcements/:id") async announcement(@Req() req: AuthRequest, @Param("id") id: string) {
    await this.auth.requireSession(req, "admin");
    return this.content.message("announcements", parse(idSchema, id));
  }
  @Get("notifications/:id") async notification(@Req() req: AuthRequest, @Param("id") id: string) {
    await this.auth.requireSession(req, "admin");
    return this.content.message("notifications", parse(idSchema, id));
  }
  @Post("announcements") async saveAnnouncement(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.content.save("announcements", a.userId, parse(announcementEditSchema, body));
  }
  @Post("notifications") async saveNotification(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.content.save("notifications", a.userId, parse(notificationEditSchema, body));
  }
  @Get("winter") async winter(@Req() req: AuthRequest) {
    await this.auth.requireSession(req, "admin");
    return this.content.winter();
  }
  @Post("winter") async saveWinter(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.content.saveWinter(a.userId, parse(winterEditSchema, body));
  }
  @Get("maintenance") async maintenance(@Req() req: AuthRequest) {
    await this.auth.requireSession(req, "admin");
    return this.availability.config();
  }
  @Post("maintenance") async saveMaintenance(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.availability.save(a.userId, parse(maintenanceEditSchema, body));
  }
  @Get("templates") async templateList(@Req() req: AuthRequest, @Query() query: unknown) {
    await this.auth.requireSession(req, "admin");
    const q = parse(
      adminPageSchema.extend({ kind: z.enum(["", ...templateKinds]).default("") }).strict(),
      query,
    );
    return this.templates.list(q.page, q.q, q.kind);
  }
  @Get("templates/:id") async templateDetail(@Req() req: AuthRequest, @Param("id") id: string) {
    await this.auth.requireSession(req, "admin");
    return this.templates.detail(parse(idSchema, id));
  }
  @Get("templates/:id/preview") async templatePreview(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    await this.auth.requireSession(req, "admin");
    return this.templates.preview(parse(idSchema, id));
  }
  @Post("templates") async saveTemplate(@Req() req: AuthRequest, @Body() body: unknown) {
    const a = await this.auth.writeSession(req, "admin");
    return this.templates.save(a.userId, parse(adminTemplateEditSchema, body));
  }
  @Post("templates/:id/copy") async copyTemplate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.auth.writeSession(req, "admin");
    return this.templates.copy(
      a.userId,
      parse(idSchema, id),
      parse(adminWriteSchema.strict(), body),
    );
  }
  @Post("templates/:id/publish") async publishTemplate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.auth.writeSession(req, "admin");
    return this.templates.publish(
      a.userId,
      parse(idSchema, id),
      parse(adminTemplatePublishSchema, body),
    );
  }
  @Get("search") async search(@Req() req: AuthRequest, @Query("q") q: unknown) {
    await this.auth.requireSession(req, "admin");
    return this.content.search(parse(z.string().trim().max(200), q ?? ""));
  }
  @Get("system") async system(@Req() req: AuthRequest) {
    await this.auth.requireSession(req, "admin");
    const started = performance.now();
    await this.auth.db.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(performance.now() - started);
    const [kodik, yummy, jobs, events] = await Promise.all([
      this.providers.state("kodik"),
      this.providers.state("yummy"),
      this.auth.db.catalogImportJob.groupBy({ by: ["status"], _count: { _all: true } }),
      this.auth.db.analyticsEvent.count({
        where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
      }),
    ]);
    const errors = await readDiagnostics();
    return {
      api: {
        status: "ready",
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      },
      database: { status: "ready", latencyMs },
      providers: { kodik, yummy },
      jobs: jobs.map((j) => ({ status: j.status, count: j._count._all })),
      events24h: events,
      errors: { total: errors.total, retentionDays: 7, dailyLimitMB: 4 },
      limits: {
        profileMedia: profileMediaLimits,
        frameSearch: "Квота trace.moe отображается на странице поиска по кадру",
        billingAvailable: false,
      },
      cache: "Внутренний кэш запросов провайдеров; отдельный сервис кэша не используется",
    };
  }
}
@Controller("api/availability")
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}
  @Get() async status() {
    try {
      return await this.availability.publicStatus();
    } catch {
      throw new ServiceUnavailableException("Сервис временно недоступен");
    }
  }
}
@Controller("api/experience")
export class ExperienceController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdministrationContentService) private readonly content: AdministrationContentService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}
  @Get() async publicExperience(@Req() req: AuthRequest, @Query("animeId") animeId: unknown) {
    return this.content.experience(
      (await this.subscriptions.viewer(req))?.userId,
      animeId === undefined ? undefined : parse(idSchema, animeId),
    );
  }
  @Post("event") async event(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.analytics.collect(req, parse(analyticsEventSchema, body));
  }
  @Get("inbox") async inbox(@Req() req: AuthRequest, @Query() query: unknown) {
    const a = await this.auth.requireSession(req);
    return this.content.inbox(a.userId, parse(adminPageSchema, query).page);
  }
  @Post("inbox/:id") async read(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.auth.writeSession(req);
    return this.content.read(
      a.userId,
      parse(idSchema, id),
      parse(z.object({ dismiss: z.boolean() }).strict(), body).dismiss,
    );
  }
}
