import { z } from "zod";
import {
  adminWriteSchema,
  announcementEditSchema,
  notificationEditSchema,
  winterSettingsSchema,
} from "./administration.js";
import { subscriptionPlanEditSchema, subscriptionPromotionEditSchema } from "./subscriptions.js";

export const maintenanceSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().trim().min(1).max(160).default("AnimeSoul обновляется"),
    body: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .default("Готовим обновление. Скоро вернёмся — спасибо, что вы с нами!"),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export const maintenanceEditSchema = adminWriteSchema
  .extend({ settings: maintenanceSettingsSchema })
  .strict();
export type MaintenanceSettings = z.infer<typeof maintenanceSettingsSchema>;
export const templateKinds = [
  "notification",
  "announcement",
  "anime-notice",
  "winter",
  "maintenance",
  "plan",
  "promotion",
] as const;
export type TemplateKind = (typeof templateKinds)[number];
const write = {
  operationId: "00000000-0000-4000-8000-000000000000",
  reason: "Template validation",
  version: 0,
};
// The same schemas validate templates and actual writes. Identity, publication state and audit fields are never stored in a preset.
export function validateTemplatePayload(kind: TemplateKind, payload: Record<string, unknown>) {
  const common = { ...payload, ...write };
  let parsed: Record<string, unknown>;
  if (kind === "notification") parsed = notificationEditSchema.parse({ ...common, enabled: false });
  else if (kind === "announcement" || kind === "anime-notice") {
    parsed = announcementEditSchema.parse({ ...common, enabled: false });
    if ((kind === "announcement") !== (parsed.scope === "global"))
      throw new Error("Размещение не соответствует типу шаблона.");
  } else if (kind === "winter") parsed = winterSettingsSchema.parse(payload);
  else if (kind === "maintenance") parsed = maintenanceSettingsSchema.parse(payload);
  else if (kind === "plan")
    parsed = subscriptionPlanEditSchema.parse({ ...common, enabled: false });
  else parsed = subscriptionPromotionEditSchema.parse({ ...common, enabled: false });
  const cleaned = { ...parsed };
  for (const key of ["operationId", "reason", "version", "create"]) delete cleaned[key];
  if (kind !== "plan") delete cleaned.id;
  if (!["winter", "maintenance"].includes(kind)) delete cleaned.enabled;
  return cleaned;
}
export const adminTemplateEditSchema = adminWriteSchema
  .extend({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(templateKinds),
    pinned: z.boolean(),
    payload: z
      .record(z.string(), z.unknown())
      .refine((v) => JSON.stringify(v).length <= 20000, "Шаблон слишком большой."),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateTemplatePayload(value.kind, value.payload);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: error instanceof Error ? error.message : "Проверьте параметры шаблона.",
      });
    }
  });
export const adminTemplatePublishSchema = adminWriteSchema
  .extend({
    targetVersion: z.number().int().nonnegative(),
    targetExists: z.boolean().default(false),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
  })
  .strict();
export type AdminTemplate = {
  id: string;
  name: string;
  kind: TemplateKind;
  pinned: boolean;
  payload: Record<string, unknown>;
  version: number;
  updatedAt: string;
};
