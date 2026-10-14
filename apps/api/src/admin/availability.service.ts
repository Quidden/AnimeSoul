import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { maintenanceSettingsSchema, type MaintenanceSettings } from "@animesoul/contracts";
import type { DatabaseTransaction } from "@animesoul/database";
import { AuthService } from "../auth/auth.service.js";
import { operation, version, type Write } from "./operations.js";

@Injectable()
export class AvailabilityService {
  private cached: { time: number; settings: MaintenanceSettings; version: number } | undefined;
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  invalidate() {
    this.cached = undefined;
  }
  async config() {
    if (!this.auth.config.DATABASE_URL)
      return { settings: maintenanceSettingsSchema.parse({}), version: 0 };
    const row = await this.auth.db.siteSetting.findUnique({
      where: { key: "availability.maintenance" },
    });
    return {
      settings: maintenanceSettingsSchema.parse(row?.value ?? {}),
      version: row?.version ?? 0,
    };
  }
  async publicStatus() {
    if (!this.cached || Date.now() - this.cached.time >= 500)
      this.cached = { ...(await this.config()), time: Date.now() };
    const { settings } = this.cached;
    const active =
      settings.enabled && (!settings.endsAt || new Date(settings.endsAt).getTime() > Date.now());
    return {
      active,
      ...(active ? { title: settings.title, body: settings.body, endsAt: settings.endsAt } : {}),
    };
  }
  async write(
    tx: DatabaseTransaction,
    input: Write & { version: number; settings: MaintenanceSettings },
  ) {
    if (
      input.settings.enabled &&
      input.settings.endsAt &&
      new Date(input.settings.endsAt).getTime() <= Date.now()
    )
      throw new BadRequestException("Укажите будущую дату открытия сайта.");
    const row = await tx.siteSetting.findUnique({ where: { key: "availability.maintenance" } });
    version(row?.version ?? 0, input.version);
    await tx.siteSetting.upsert({
      where: { key: "availability.maintenance" },
      create: { key: "availability.maintenance", value: input.settings, version: 1 },
      update: { value: input.settings, version: { increment: 1 } },
    });
    return {
      objectId: "availability.maintenance",
      details: { before: row?.value ?? null, after: input.settings },
    };
  }
  async save(actorId: string, input: Write & { version: number; settings: MaintenanceSettings }) {
    await operation(this.auth.db, actorId, "admin.maintenance.saved", input, (tx) =>
      this.write(tx, input),
    );
    this.invalidate();
    return this.config();
  }
}
