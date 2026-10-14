import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@animesoul/database";
import {
  adminTemplateEditSchema,
  adminTemplatePublishSchema,
  validateTemplatePayload,
  announcementEditSchema,
  notificationEditSchema,
  subscriptionPlanEditSchema,
  subscriptionPromotionEditSchema,
  winterSettingsSchema,
  maintenanceSettingsSchema,
  type AdminTemplate,
} from "@animesoul/contracts";
import type { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import { AdministrationContentService } from "./content.service.js";
import { AvailabilityService } from "./availability.service.js";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";
import { operation, version, type Write } from "./operations.js";

@Injectable()
export class AdminTemplatesService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdministrationContentService) private readonly content: AdministrationContentService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}
  private item(row: {
    key: string;
    value: Prisma.JsonValue;
    version: number;
    updatedAt: Date;
  }): AdminTemplate {
    const value = row.value as unknown as Omit<AdminTemplate, "id" | "version" | "updatedAt">;
    return {
      ...value,
      id: row.key.slice(9),
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async list(page = 1, q = "", kind = "") {
    const where = Prisma.sql`key LIKE 'template.%' AND (${kind}='' OR value->>'kind'=${kind}) AND (${q}='' OR strpos(lower(value->>'name'),lower(${q}))>0)`;
    const [rows, counts] = await Promise.all([
      this.auth.db.$queryRaw<
        { key: string; value: Prisma.JsonValue; version: number; updatedAt: Date }[]
      >(
        Prisma.sql`SELECT * FROM "SiteSetting" WHERE ${where} ORDER BY (value->>'pinned')::boolean DESC,"updatedAt" DESC,key ASC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      ),
      this.auth.db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) FROM "SiteSetting" WHERE ${where}`,
      ),
    ]);
    return {
      items: rows.map((r) => this.item(r)),
      total: Number(counts[0]?.count ?? 0),
      page,
      pageSize: 25,
    };
  }
  async detail(id: string) {
    const row = await this.auth.db.siteSetting.findUnique({ where: { key: "template." + id } });
    if (!row) throw new NotFoundException("Шаблон не найден.");
    return this.item(row);
  }
  async save(actorId: string, input: z.infer<typeof adminTemplateEditSchema>) {
    const id = input.id ?? randomUUID();
    await operation(this.auth.db, actorId, "admin.template.saved", input, async (tx) => {
      const key = "template." + id;
      const old = await tx.siteSetting.findUnique({ where: { key } });
      if (input.id && !old) throw new NotFoundException("Шаблон не найден.");
      version(old?.version ?? 0, input.version);
      if (
        !old &&
        (await tx.siteSetting.count({ where: { key: { startsWith: "template." } } })) >= 1000
      )
        throw new BadRequestException("Поддерживается до 1000 шаблонов.");
      const value = {
        name: input.name,
        kind: input.kind,
        pinned: input.pinned,
        payload: validateTemplatePayload(input.kind, input.payload),
      } as Prisma.InputJsonValue;
      await tx.siteSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value, version: { increment: 1 } },
      });
      return {
        objectId: id,
        details: { kind: input.kind, pinned: input.pinned, fields: ["name", "payload"] },
      };
    });
    const audit = await this.auth.db.auditEvent.findUniqueOrThrow({
      where: { operationId: input.operationId },
    });
    return this.detail(audit.objectId!);
  }
  async copy(actorId: string, id: string, input: Write & { version: number }) {
    const nextId = randomUUID();
    await operation(
      this.auth.db,
      actorId,
      "admin.template.copied",
      { ...input, templateId: id } as typeof input,
      async (tx) => {
        const row = await tx.siteSetting.findUnique({ where: { key: "template." + id } });
        if (!row) throw new NotFoundException("Шаблон не найден.");
        version(row.version, input.version);
        if ((await tx.siteSetting.count({ where: { key: { startsWith: "template." } } })) >= 1000)
          throw new BadRequestException("Поддерживается до 1000 шаблонов.");
        const source = this.item(row);
        await tx.siteSetting.create({
          data: {
            key: "template." + nextId,
            value: {
              name: source.name.slice(0, 150) + " — копия",
              kind: source.kind,
              pinned: false,
              payload: source.payload,
            } as Prisma.InputJsonValue,
          },
        });
        return { objectId: nextId, details: { sourceId: id, kind: source.kind } };
      },
    );
    const audit = await this.auth.db.auditEvent.findUniqueOrThrow({
      where: { operationId: input.operationId },
    });
    return this.detail(audit.objectId!);
  }
  async preview(id: string) {
    const template = await this.detail(id);
    let targetVersion = 0;
    let current: unknown = null;
    if (template.kind === "winter") {
      const c = await this.content.winter();
      targetVersion = c.version;
      current = c.settings;
    }
    if (template.kind === "maintenance") {
      const c = await this.availability.config();
      targetVersion = c.version;
      current = c.settings;
    }
    if (template.kind === "plan") {
      const c = await this.auth.db.subscriptionPlan.findUnique({
        where: { id: String(template.payload.id) },
      });
      targetVersion = c?.version ?? 0;
      current = c;
    }
    return { template, targetVersion, current };
  }
  async publish(actorId: string, id: string, input: z.infer<typeof adminTemplatePublishSchema>) {
    await operation(
      this.auth.db,
      actorId,
      "admin.template.published",
      { ...input, templateId: id } as typeof input,
      async (tx) => {
        const row = await tx.siteSetting.findUnique({ where: { key: "template." + id } });
        if (!row) throw new NotFoundException("Шаблон не найден.");
        version(row.version, input.version);
        const t = this.item(row),
          payload = validateTemplatePayload(t.kind, t.payload);
        const startsAt = input.startsAt ?? new Date().toISOString();
        const endsAt = input.endsAt === undefined ? payload.endsAt : input.endsAt;
        if (
          ["notification", "announcement", "anime-notice", "promotion"].includes(t.kind) &&
          endsAt &&
          new Date(String(endsAt)).getTime() <= Date.now()
        )
          throw new BadRequestException("Измените завершённый период публикации.");
        const message = {
          ...payload,
          ...input,
          version: 0,
          enabled: true,
          startsAt,
          endsAt: endsAt ?? null,
        };
        delete (message as Record<string, unknown>).targetVersion;
        delete (message as Record<string, unknown>).targetExists;
        let change: { objectId: string; details?: Prisma.InputJsonValue };
        let route: string;
        if (t.kind === "notification") {
          change = await this.content.writeMessage(
            tx,
            "notifications",
            notificationEditSchema.parse(message),
          );
          route = "notifications";
        } else if (t.kind === "announcement" || t.kind === "anime-notice") {
          change = await this.content.writeMessage(
            tx,
            "announcements",
            announcementEditSchema.parse(message),
          );
          route = t.kind === "announcement" ? "announcements" : "anime-notices";
        } else if (t.kind === "winter") {
          change = await this.content.writeWinter(tx, {
            ...input,
            version: input.targetVersion,
            settings: winterSettingsSchema.parse(payload),
          });
          route = "winter";
        } else if (t.kind === "maintenance") {
          change = await this.availability.write(tx, {
            ...input,
            version: input.targetVersion,
            settings: maintenanceSettingsSchema.parse(payload),
          });
          route = "maintenance";
        } else if (t.kind === "plan") {
          const existing = await tx.subscriptionPlan.findUnique({
            where: { id: String(payload.id) },
          });
          if (Boolean(existing) !== input.targetExists)
            throw new ConflictException("Тариф изменился. Повторите предпросмотр.");
          version(existing?.version ?? 0, input.targetVersion);
          const plan = {
            ...payload,
            ...input,
            enabled: true,
            create: !existing,
            version: input.targetVersion,
          };
          delete (plan as Record<string, unknown>).targetVersion;
          delete (plan as Record<string, unknown>).targetExists;
          delete (plan as Record<string, unknown>).startsAt;
          delete (plan as Record<string, unknown>).endsAt;
          change = await this.subscriptions.writePlan(tx, subscriptionPlanEditSchema.parse(plan));
          route = "plans";
        } else {
          change = await this.subscriptions.writePromotion(
            tx,
            subscriptionPromotionEditSchema.parse(message),
          );
          route = "promotions";
        }
        return { objectId: id, details: { kind: t.kind, targetId: change.objectId, route } };
      },
    );
    this.availability.invalidate();
    const audit = await this.auth.db.auditEvent.findUniqueOrThrow({
      where: { operationId: input.operationId },
    });
    return audit.details;
  }
}
