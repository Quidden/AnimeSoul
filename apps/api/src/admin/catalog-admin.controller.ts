import { Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  catalogControlSchema,
  catalogStartSchema,
  mappingResolveSchema,
  providerSwitchSchema,
  reserveAccessSchema,
} from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { parse } from "../auth/auth.controller.js";
import { CONFIG, type Configuration } from "../config.js";
import { ProvidersService } from "../providers/providers.service.js";
import { controlCatalog, enqueueCatalog } from "../providers/catalog-jobs.js";
import {
  providerAccess,
  grantReserveAccess,
  reservePermission,
} from "../providers/reserve-access.js";
import { resolveMapping, switchProvider } from "../providers/provider-management.js";
@Controller("api/admin")
export class CatalogAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
    @Inject(CONFIG) private readonly config: Configuration,
  ) {}
  @Get("catalog")
  async dashboard(@Req() request: AuthRequest, @Query("page") value: unknown) {
    const session = await this.auth.requireSession(request, "admin", "providers");
    const access = providerAccess(session.user);
    const requested = parse(z.coerce.number().int().min(1).max(100000).default(1), value);
    const db = this.auth.db;
    const totalConflicts = access.canManageCatalog
      ? await db.providerMappingConflict.count({ where: { status: "open" } })
      : 0;
    const pages = Math.max(1, Math.ceil(totalConflicts / 20));
    const page = Math.min(requested, pages);
    const [settings, jobs, conflicts] = await Promise.all([
      db.providerSetting.findMany(),
      db.catalogImportJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          provider: true,
          status: true,
          offset: true,
          strategy: true,
          upperBound: true,
          pages: true,
          imported: true,
          rejected: true,
          conflicts: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
      db.providerMappingConflict.findMany({
        where: { status: "open" },
        orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * 20,
        take: 20,
        select: {
          id: true,
          provider: true,
          externalId: true,
          previousExternalId: true,
          version: true,
          incoming: { select: { id: true, slug: true, title: true, year: true } },
          existing: { select: { id: true, slug: true, title: true, year: true } },
        },
      }),
    ]);
    const reserveManagers = access.canDelegateReserve
      ? await db.userPermission.findMany({
          where: { permission: reservePermission },
          select: { user: { select: { profile: { select: { username: true } } } } },
          orderBy: { createdAt: "asc" },
          take: 100,
        })
      : [];
    const providers = await Promise.all(
      (["kodik", "yummy"] as const).map(async (name) => ({
        name,
        enabled: settings.find((s) => s.key === name)?.enabled ?? false,
        environmentAllows:
          (name === "yummy" ? this.config.ALLOW_YUMMY : this.config.ALLOW_KODIK) === "true",
        hasCredentials: Boolean(
          name === "yummy" ? this.config.YUMMY_TOKEN : this.config.KODIK_TOKEN,
        ),
        state: await this.providers.state(name),
      })),
    );
    return {
      access,
      reserveManagers: reserveManagers
        .map((entry) => ({ username: entry.user.profile?.username ?? "" }))
        .filter((entry) => entry.username),
      providers,
      jobs: access.canManageCatalog ? jobs : [],
      conflicts: access.canManageCatalog ? conflicts : [],
      totalConflicts,
      page,
      pages,
    };
  }
  @Post("providers/switch")
  async switch(@Req() request: AuthRequest, @Body() body: unknown) {
    const session = await this.auth.writeSession(request, "admin", "providers");
    const input = parse(providerSwitchSchema, body);
    const result = await switchProvider(
      this.auth.db,
      this.config,
      input.provider,
      input.enabled,
      input.reason,
      session.userId,
    );
    await this.providers.state(input.provider);
    return result;
  }
  @Post("providers/access")
  async access(@Req() request: AuthRequest, @Body() body: unknown) {
    const session = await this.auth.writeSession(request, "admin");
    const input = parse(reserveAccessSchema, body);
    return grantReserveAccess(
      this.auth.db,
      session.userId,
      input.username,
      input.enabled,
      input.reason,
    );
  }
  @Post("catalog/import")
  async start(@Req() request: AuthRequest, @Body() body: unknown) {
    const session = await this.auth.writeSession(request, "admin");
    return enqueueCatalog(this.auth.db, session.userId, parse(catalogStartSchema, body).reason);
  }
  @Post("catalog/job")
  async control(@Req() request: AuthRequest, @Body() body: unknown) {
    const session = await this.auth.writeSession(request, "admin");
    const input = parse(catalogControlSchema, body);
    return controlCatalog(this.auth.db, input.id, input.action, session.userId, input.reason);
  }
  @Post("catalog/resolve")
  async resolve(@Req() request: AuthRequest, @Body() body: unknown) {
    const session = await this.auth.writeSession(request, "admin");
    const input = parse(mappingResolveSchema, body);
    return resolveMapping(
      this.auth.db,
      input.id,
      input.version,
      input.decision,
      input.reason,
      session.userId,
    );
  }
}
