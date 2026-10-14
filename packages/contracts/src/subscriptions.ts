import { z } from "zod";

export const nativePlayerPermission = "player.native";
export const trialDays = 7;
export const subscriptionPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(""),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  permissions: z.array(z.literal(nativePlayerPermission)).max(1).default([nativePlayerPermission]),
  months: z.number().int().min(1).max(24),
  amountMinor: z.number().int().min(1).max(10_000_000).nullable(),
  currency: z.enum(["UAH", "USD", "EUR"]),
  enabled: z.boolean(),
  version: z.number().int().nonnegative().default(0),
});
export const subscriptionPlanEditSchema = subscriptionPlanSchema
  .extend({
    reason: z.string().trim().min(3).max(500),
    create: z.boolean().optional(),
    operationId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => !v.enabled || v.permissions.includes(nativePlayerPermission),
    "Включённый тариф должен предоставлять доступ к плееру.",
  );
export const subscriptionPromotionSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(""),
  planIds: z
    .array(z.string().regex(/^[a-z0-9-]{1,40}$/))
    .max(24)
    .default([]),
  percent: z.number().int().min(1).max(100),
  months: z.array(z.number().int().min(1).max(24)).max(24),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  enabled: z.boolean(),
  version: z.number().int().nonnegative().default(0),
});
export const subscriptionPromotionEditSchema = subscriptionPromotionSchema
  .omit({ id: true })
  .extend({
    id: z.uuid().optional(),
    reason: z.string().trim().min(3).max(500),
    operationId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "Конец акции должен быть позже начала.",
    path: ["endsAt"],
  });
export const nativeAccessEditSchema = z
  .object({
    username: z.string().trim().min(1).max(40),
    enabled: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((value) => !value.enabled || value.expiresAt !== null, {
    path: ["expiresAt"],
    message: "Укажите срок доступа.",
  });
export const subscriptionSchema = z.object({
  authenticated: z.boolean(),
  nativeAccess: z.boolean(),
  source: z.enum(["none", "trial", "subscription", "permission", "staff"]),
  expiresAt: z.iso.datetime().nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
  firstMonthDiscount: z.boolean(),
  directEnabled: z.boolean(),
  billingAvailable: z.literal(false),
  plans: z
    .array(
      subscriptionPlanSchema.extend({
        discountPercent: z.number().int().min(0).max(100),
        finalAmountMinor: z.number().int().nonnegative().nullable(),
        discountName: z.string().max(100).nullable(),
      }),
    )
    .max(24),
});
export const subscriptionAdminSchema = z.object({
  plans: z.array(subscriptionPlanSchema).max(24),
  promotions: z.array(subscriptionPromotionSchema).max(100),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type SubscriptionPromotion = z.infer<typeof subscriptionPromotionSchema>;
export type SubscriptionAdmin = z.infer<typeof subscriptionAdminSchema>;
export const defaultSubscriptionPlans: SubscriptionPlan[] = [
  { id: "monthly", name: "На месяц", months: 1, amountMinor: null, currency: "UAH", enabled: true },
  {
    id: "quarterly",
    name: "На три месяца",
    months: 3,
    amountMinor: null,
    currency: "UAH",
    enabled: true,
  },
  { id: "yearly", name: "На год", months: 12, amountMinor: null, currency: "UAH", enabled: true },
].map((plan) => subscriptionPlanSchema.parse(plan));
export function subscriptionQuote(
  plan: SubscriptionPlan,
  promotions: SubscriptionPromotion[],
  firstMonth: boolean,
  now = new Date(),
) {
  const offers = promotions.filter(
    (offer) =>
      offer.enabled &&
      new Date(offer.startsAt) <= now &&
      new Date(offer.endsAt) > now &&
      (!offer.months.length || offer.months.includes(plan.months)) &&
      (!offer.planIds?.length || offer.planIds.includes(plan.id)),
  );
  const promotion = offers.sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id))[0];
  const first = firstMonth && plan.months === 1;
  const discountPercent = Math.max(first ? 50 : 0, promotion?.percent ?? 0);
  return {
    ...plan,
    discountPercent,
    finalAmountMinor:
      plan.amountMinor === null
        ? null
        : Math.round((plan.amountMinor * (100 - discountPercent)) / 100),
    discountName:
      discountPercent === 0
        ? null
        : first && discountPercent === 50
          ? "Первый месяц после пробного периода"
          : promotion!.name,
  };
}
