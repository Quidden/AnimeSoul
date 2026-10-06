import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service.js";
@Controller("api")
export class HealthController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  @Get("health")
  health() {
    return { status: "ok", version: "0.4.0" };
  }
  @Get("ready")
  async ready() {
    try {
      if (await this.catalog.ready()) return { status: "ready" };
    } catch {
      /* Do not expose database details. */
    }
    throw new ServiceUnavailableException("Database is not ready.");
  }
}
