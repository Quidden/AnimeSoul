import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { CONFIG, readConfig, type Configuration } from "./config.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { HealthController } from "./health/health.controller.js";
import { AdminController } from "./admin/admin.controller.js";
export async function createApplication(
  config: Configuration = readConfig(),
): Promise<NestFastifyApplication> {
  @Module({
    controllers: [CatalogController, HealthController, AdminController],
    providers: [{ provide: CONFIG, useValue: config }, CatalogService],
  })
  class ApplicationModule {}
  const app = await NestFactory.create<NestFastifyApplication>(
    ApplicationModule,
    new FastifyAdapter({ bodyLimit: 65536, trustProxy: false }),
    { logger: false },
  );
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const server = app.getHttpAdapter().getInstance();
  server.addHook(
    "onRequest",
    async (
      request: { url: string },
      reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    ) => {
      if (/^\/api\/admin(?:[/?]|$)/.test(request.url))
        return reply.code(401).send({ statusCode: 401, message: "Unauthorized" });
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
