import "reflect-metadata";
import { isTrustedRequestOrigin } from "@animesoul/contracts";
import {
  ForbiddenException,
  HttpException,
  Module,
  UnsupportedMediaTypeException,
  type ArgumentsHost,
} from "@nestjs/common";
import { BaseExceptionFilter, NestFactory } from "@nestjs/core";
import { writeDiagnostic } from "@animesoul/diagnostics";
import { diagnosticError } from "@animesoul/diagnostics/sanitize";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { CONFIG, readConfig, type Configuration } from "./config.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { HealthController } from "./health/health.controller.js";
import { CatalogAdminController } from "./admin/catalog-admin.controller.js";
import { AdminController } from "./admin/admin.controller.js";
import { PlaybackController, PlaybackRevisionController } from "./playback/playback.controller.js";
import { PlaybackService } from "./playback/playback.service.js";
import { EpisodeService } from "./playback/episode.service.js";
import { ProgressService } from "./playback/progress.service.js";
import { DirectStreamService } from "./playback/direct-stream.service.js";
import { SubscriptionsService } from "./subscriptions/subscriptions.service.js";
import {
  SubscriptionController,
  SubscriptionAdminController,
} from "./subscriptions/subscriptions.controller.js";
import {
  EpisodesController,
  ProgressController,
  EpisodeSitemapController,
} from "./playback/episodes.controller.js";
import { ProvidersService } from "./providers/providers.service.js";
import { UPSTREAM_FETCH, type UpstreamFetch } from "./providers/provider-http.js";
import { AuthService, type AuthRequest } from "./auth/auth.service.js";
import { AuthController, AdminAuthController } from "./auth/auth.controller.js";
import { AccountService } from "./account/account.service.js";
import { AccountController } from "./account/account.controller.js";
import {
  ProfileMediaController,
  ProfileMediaReadController,
} from "./account/profile-media.controller.js";
import { ProfileMediaService } from "./account/profile-media.service.js";
import { profileMediaLimits, frameSearchLimits } from "@animesoul/contracts";
import { FrameSearchController } from "./catalog/frame-search.controller.js";
import { FRAME_SEARCH_FETCH, FrameSearchService } from "./catalog/frame-search.service.js";
import { SocialController } from "./social/social.controller.js";
import { SocialService } from "./social/social.service.js";
import { ContentService } from "./content/content.service.js";
import { ContentController } from "./content/content.controller.js";
import { IdentityController } from "./auth/identity.controller.js";
import { AccountEmailService } from "./auth/account-email.service.js";
import { GoogleAuthService } from "./auth/google-auth.service.js";
import { GOOGLE_CLIENT, GoogleClient } from "./auth/google-client.js";
import { ACCOUNT_MAIL, accountMailDelivery, type MailDelivery } from "./auth/account-mailer.js";
import { AdminUsersService } from "./admin/users.service.js";
import { AnalyticsService } from "./admin/analytics.service.js";
import { AdministrationContentService } from "./admin/content.service.js";
import {
  AdminPlatformController,
  ExperienceController,
  AvailabilityController,
} from "./admin/platform.controller.js";
import { AvailabilityService } from "./admin/availability.service.js";
import { AdminTemplatesService } from "./admin/templates.service.js";
export async function createApplication(
  config: Configuration = readConfig(),
  upstreamFetch: UpstreamFetch = fetch,
  identity: { fetch?: typeof fetch; mail?: MailDelivery; frameFetch?: typeof fetch } = {},
): Promise<NestFastifyApplication> {
  @Module({
    controllers: [
      CatalogController,
      FrameSearchController,
      HealthController,
      AdminController,
      CatalogAdminController,
      PlaybackController,
      SubscriptionController,
      SubscriptionAdminController,
      PlaybackRevisionController,
      EpisodesController,
      ProgressController,
      EpisodeSitemapController,
      AuthController,
      AdminAuthController,
      AccountController,
      ProfileMediaController,
      ProfileMediaReadController,
      SocialController,
      ContentController,
      IdentityController,
      AdminPlatformController,
      AvailabilityController,
      ExperienceController,
    ],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: UPSTREAM_FETCH, useValue: upstreamFetch },
      CatalogService,
      FrameSearchService,
      { provide: FRAME_SEARCH_FETCH, useValue: identity.frameFetch ?? fetch },
      ProvidersService,
      PlaybackService,
      EpisodeService,
      ProgressService,
      DirectStreamService,
      SubscriptionsService,
      AuthService,
      AccountService,
      ProfileMediaService,
      SocialService,
      ContentService,
      AccountEmailService,
      GoogleAuthService,
      AdminUsersService,
      AnalyticsService,
      AdministrationContentService,
      AvailabilityService,
      AdminTemplatesService,
      { provide: GOOGLE_CLIENT, useValue: new GoogleClient(config, identity.fetch ?? fetch) },
      { provide: ACCOUNT_MAIL, useValue: identity.mail ?? accountMailDelivery(config) },
    ],
  })
  class ApplicationModule {}
  const app = await NestFactory.create<NestFastifyApplication>(
    ApplicationModule,
    new FastifyAdapter({ bodyLimit: 65536, trustProxy: false }),
    { logger: false },
  );
  const exceptions = new BaseExceptionFilter(app.getHttpAdapter());
  app.useGlobalFilters({
    async catch(error: unknown, host: ArgumentsHost) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      if (status >= 500) {
        const request = host.switchToHttp().getRequest<{ url: string }>();
        await writeDiagnostic({
          ...diagnosticError(error),
          source: "api",
          kind: "request",
          path: request.url.split("?")[0] ?? "/",
        });
      }
      exceptions.catch(error, host);
    },
  });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } });
  const server = app.getHttpAdapter().getInstance();
  server.addHook(
    "onSend",
    async (
      request: { url: string },
      reply: { header: (key: string, value: string) => unknown },
      payload: unknown,
    ) => {
      if (/^\/api\/(admin|experience)(?:[/?]|$)/.test(request.url))
        reply.header("Cache-Control", "private, no-store");
      return payload;
    },
  );
  server.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: profileMediaLimits.banner },
    (_request: unknown, body: Buffer, done: (error: Error | null, value?: Buffer) => void) =>
      done(null, body),
  );
  server.addHook(
    "onRoute",
    (route: { url: string; bodyLimit?: number; config?: Record<string, unknown> }) => {
      // Frontends check availability before forwarding requests. These cheap
      // status reads must neither consume the traffic budget nor turn 429 into 503.
      if (["/api/availability", "/api/health", "/api/ready"].includes(route.url))
        route.config = { ...route.config, rateLimit: false };
      // Restoring staff access must remain possible while the page is busy.
      // Authentication, role, origin and CSRF checks still run for this route.
      if (route.url === "/api/auth/developer-access")
        route.config = { ...route.config, rateLimit: { max: 60, timeWindow: "1 minute" } };
      // The refreshed account and player must observe the restored access even
      // when unrelated page requests have exhausted the shared budget.
      if (["/api/auth/me", "/api/subscription"].includes(route.url))
        route.config = { ...route.config, rateLimit: { max: 120, timeWindow: "1 minute" } };
      const kind = /^\/api\/account\/profile\/media\/(avatar|banner)$/.exec(route.url)?.[1];
      if (route.url === "/api/search/frame") {
        route.bodyLimit = frameSearchLimits.bytes;
        route.config = { ...route.config, rateLimit: { max: 5, timeWindow: "1 minute" } };
      }
      if (kind) {
        route.bodyLimit = profileMediaLimits[kind as "avatar" | "banner"];
        route.config = { ...route.config, rateLimit: { max: 10, timeWindow: "1 minute" } };
      }
    },
  );
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    errorResponseBuilder: () =>
      new HttpException("Слишком много запросов. Подождите и повторите.", 429),
  });
  server.addHook(
    "onRequest",
    async (
      request: AuthRequest & { url: string; method: string },
      reply: {
        header: (key: string, value: string) => unknown;
        code: (status: number) => { send: (body: unknown) => unknown };
      },
    ) => {
      if (
        /^\/api\//.test(request.url) &&
        !/^\/api\/(?:admin(?:[/?]|$)|availability(?:\?|$)|health(?:\?|$)|ready(?:\?|$))/.test(
          request.url,
        )
      ) {
        let state;
        try {
          state = await app.get(AvailabilityService).publicStatus();
        } catch {
          return reply.code(503).send({ statusCode: 503, message: "Сервис временно недоступен" });
        }
        if (state.active) {
          reply.header("Retry-After", "60");
          reply.header("Cache-Control", "no-store");
          return reply.code(503).send({ statusCode: 503, message: state.title, maintenance: true });
        }
      }
      if (request.method === "POST" && /^\/api\/search\/frame(?:\?|$)/.test(request.url)) {
        if (
          !isTrustedRequestOrigin(request.headers.origin, config.SITE_URL) ||
          request.headers["x-animesoul-request"] !== "1"
        )
          throw new ForbiddenException("Запрос поиска отклонён.");
        if (request.headers["content-type"] !== "application/octet-stream")
          throw new UnsupportedMediaTypeException("Ожидается файл изображения.");
      }
      if (
        request.method === "POST" &&
        /^\/api\/account\/profile\/media(?:\/(?:avatar|banner))?(?:\?|$)/.test(request.url)
      )
        await app.get(AuthService).writeSession(request);
      if (
        /^\/api\/admin(?:[/?]|$)/.test(request.url) &&
        !(request.method === "POST" && request.url === "/api/admin/auth/login")
      ) {
        try {
          const route = request.method + " " + request.url.split("?")[0];
          const scoped = [
            "GET /api/admin/auth/me",
            "POST /api/admin/auth/logout",
            "GET /api/admin/catalog",
            "POST /api/admin/providers/switch",
          ].includes(route);
          await app
            .get(AuthService)
            .requireSession(request, "admin", scoped ? "providers" : "admin");
        } catch (error) {
          const status = error instanceof HttpException ? error.getStatus() : 503;
          return reply.code(status).send({
            statusCode: status,
            message:
              status === 403
                ? "Forbidden"
                : status === 503
                  ? "Service unavailable"
                  : "Unauthorized",
          });
        }
      }
    },
  );
  server.addHook(
    "onSend",
    async (_request: unknown, reply: { header: (key: string, value: string) => void }) => {
      reply.header("Cache-Control", "no-store");
    },
  );
  app.enableShutdownHooks();
  await app.init();
  await server.ready();
  return app;
}
