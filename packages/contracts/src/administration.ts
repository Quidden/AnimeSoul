import { z } from "zod";
import { usernameSchema } from "./account.js";

export const administrativeRoles = ["owner", "admin"] as const;
export const managedPermissions = ["player.native", "providers.yummy.manage"] as const;
export const adminReasonSchema = z.string().trim().min(3).max(500);
export const adminWriteSchema = z.object({
  reason: adminReasonSchema,
  operationId: z.uuid(),
  version: z.number().int().nonnegative(),
});
export const adminPostPinSchema = adminWriteSchema
  .omit({ version: true })
  .extend({ pinned: z.boolean() })
  .strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(v + "T00:00:00Z");
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.getUTCFullYear() >= 1970 &&
      parsed.getUTCFullYear() <= 2100 &&
      parsed.toISOString().slice(0, 10) === v
    );
  }, "Некорректная дата.");
export const adminPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  q: z.string().trim().max(200).default(""),
});
export const adminUsersQuerySchema = adminPageSchema
  .extend({
    role: z.enum(["", "owner", "admin", "member"]).default(""),
    permission: z.enum(["", ...managedPermissions]).default(""),
    plan: z
      .string()
      .regex(/^[a-z0-9-]{0,40}$/)
      .default(""),
    subscription: z.enum(["", "active", "trial", "expired", "none"]).default(""),
    status: z.enum(["", "enabled", "disabled"]).default(""),
    activity: z.enum(["", "day", "week", "month", "inactive"]).default(""),
    from: date.optional(),
    to: date.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    minLaunches: z.coerce.number().int().min(0).max(10000000).optional(),
    maxLaunches: z.coerce.number().int().min(0).max(10000000).optional(),
    sort: z
      .enum(["createdAt", "username", "email", "lastActiveAt", "launches"])
      .default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();
export const adminUserEditSchema = adminWriteSchema
  .extend({
    username: usernameSchema.optional(),
    about: z.string().trim().max(2000).optional(),
    disabled: z.boolean().optional(),
    roles: z.array(z.enum(administrativeRoles)).max(2).optional(),
    permissions: z.array(z.enum(managedPermissions)).max(2).optional(),
  })
  .strict()
  .refine(
    (v) => [v.username, v.about, v.disabled, v.roles, v.permissions].some((x) => x !== undefined),
    "Нет изменений.",
  );
export const adminUserAccessSchema = adminWriteSchema
  .extend({
    enabled: z.boolean(),
    planId: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((v) => !v.enabled || v.expiresAt !== null, "Укажите срок доступа.");
export const adminBulkUsersSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(50),
    disabled: z.boolean(),
    reason: adminReasonSchema,
    operationId: z.uuid(),
  })
  .strict();
export const adminJournalQuerySchema = adminPageSchema
  .extend({
    userId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    category: z.enum(["all", "user", "admin"]).default("all"),
    action: z.string().trim().max(100).default(""),
    from: date.optional(),
    to: date.optional(),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();
export const analyticsQuerySchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    period: z.enum(["today", "7", "30", "90", "custom"]).default("30"),
    group: z.enum(["day", "week", "month"]).default("day"),
    timezone: z.enum(["UTC", "Europe/Kyiv"]).default("Europe/Kyiv"),
    userId: z.uuid().optional(),
    animeId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.period !== "custom" || Boolean(v.from && v.to),
    "Выберите начало и конец периода.",
  );
export const analyticsEventSchema = z
  .object({
    id: z.uuid(),
    visitorId: z.uuid(),
    visitId: z.uuid(),
    kind: z.enum(["page_view", "player_start", "feature"]),
    path: z
      .enum([
        "/",
        "/catalog",
        "/anime",
        "/episode",
        "/users",
        "/account",
        "/search",
        "/subscription",
        "/posts",
        "/other",
      ])
      .optional(),
    feature: z.enum(["search.text", "search.frame", "media.giphy"]).optional(),
    animeId: z.uuid().optional(),
    episodeId: z.uuid().optional(),
    season: z.string().max(30).optional(),
    episode: z.string().max(30).optional(),
    player: z.enum(["native", "kodik", "yummy"]).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.kind === "page_view"
        ? Boolean(v.path)
        : v.kind === "feature"
          ? Boolean(v.feature)
          : Boolean(v.animeId && v.player),
    "Не хватает данных события.",
  );
export const messageKinds = ["info", "warning", "error", "important"] as const;
export const messageAudiences = ["all", "authenticated", "role", "subscription", "user"] as const;
const messageShape = {
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  kind: z.enum(messageKinds),
  audience: z.enum(messageAudiences),
  role: z.enum(administrativeRoles).nullable(),
  planId: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .nullable(),
  userId: z.uuid().nullable(),
  link: z
    .string()
    .max(500)
    .regex(/^\/(?!\/)[^\s\\]*$/)
    .nullable(),
  enabled: z.boolean(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
};
function validAudience(v: {
  audience: string;
  role: string | null;
  planId: string | null;
  userId: string | null;
}) {
  return (
    (v.audience === "role" ? Boolean(v.role) : v.role === null) &&
    (v.audience === "subscription" ? Boolean(v.planId) : v.planId === null) &&
    (v.audience === "user" ? Boolean(v.userId) : v.userId === null)
  );
}
export const announcementEditSchema = adminWriteSchema
  .extend({
    ...messageShape,
    audience: z.enum(["all", "authenticated", "role", "subscription"]),
    scope: z.enum(["global", "season", "franchise"]),
    animeId: z.uuid().nullable(),
    dismissible: z.boolean(),
    priority: z.number().int().min(-100).max(100),
  })
  .strict()
  .refine(validAudience, "Уточните аудиторию.")
  .refine(
    (v) => (v.scope === "global" ? v.animeId === null : Boolean(v.animeId)),
    "Выберите аниме.",
  )
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, "Конец публикации должен быть позже начала.");
export const notificationEditSchema = adminWriteSchema
  .extend(messageShape)
  .strict()
  .refine(validAudience, "Уточните аудиторию.")
  .refine((v) => v.audience !== "all", "Персональные уведомления требуют авторизации.")
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, "Конец публикации должен быть позже начала.");
export const winterSettingsSchema = z
  .object({
    mode: z.enum(["off", "on", "schedule"]).default("off"),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    snow: z.boolean().default(true),
    intensity: z.number().int().min(5).max(100).default(35),
    speed: z.number().min(0.25).max(3).default(1),
    garlands: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => v.mode !== "schedule" || Boolean(v.startsAt && v.endsAt && v.endsAt > v.startsAt),
    "Задайте период зимнего оформления.",
  );
export const winterEditSchema = adminWriteSchema
  .extend({ settings: winterSettingsSchema })
  .strict();

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminUserEdit = z.infer<typeof adminUserEditSchema>;
export type AdminUserAccess = z.infer<typeof adminUserAccessSchema>;
export type AdminJournalQuery = z.infer<typeof adminJournalQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsInput = z.infer<typeof analyticsEventSchema>;
export type AnnouncementEdit = z.infer<typeof announcementEditSchema>;
export type NotificationEdit = z.infer<typeof notificationEditSchema>;
export type WinterSettings = z.infer<typeof winterSettingsSchema>;
export type AdminUserRow = {
  id: string;
  username: string;
  email: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  disabledAt: string | null;
  roles: string[];
  permissions: string[];
  version: number;
  launches: number;
  subscription: {
    status: string;
    source: string;
    planId: string | null;
    planName: string | null;
    expiresAt: string | null;
  };
};
export type AdminUserDetail = {
  user: AdminUserRow;
  about: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  effectiveRights: string[];
  counts: { library: number; posts: number; comments: number; activeSessions: number };
  accessHistory: {
    id: string;
    planId: string | null;
    source: string;
    permission: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string | null;
    amountMinor: number | null;
    currency: string | null;
  }[];
  trial: { startedAt: string; expiresAt: string; revokedAt: string | null } | null;
};
export type AdminUsersPage = {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  month: string;
};
export type JournalRow = {
  id: string;
  time: string;
  action: string;
  category: "user" | "admin";
  actorId: string | null;
  actorName: string | null;
  objectId: string | null;
  reason: string | null;
  details: unknown;
  result: string;
};
export type JournalPage = { items: JournalRow[]; total: number; page: number; pageSize: number };
export type AnalyticsBucket = {
  date: string;
  pageViews: number;
  visits: number;
  visitors: number;
  activeUsers: number;
  launches: number;
  launchUsers: number;
  registrations: number;
  features: number;
};
export type AnalyticsSummary = {
  totalUsers: number;
  registrations: number;
  pageViews: number;
  visits: number;
  visitors: number;
  launches: number;
  launchUsers: number;
  averageLaunches: number;
  dau: number;
  wau: number;
  mau: number;
  activeSubscribers: number;
  trials: number;
  nativePermissions: number;
};
export type AnalyticsReport = {
  quotaHistory: { date: string; used: number; total: number }[];
  from: string;
  to: string;
  timezone: string;
  group: string;
  collectedSince: string | null;
  current: AnalyticsSummary;
  previous: AnalyticsSummary;
  buckets: AnalyticsBucket[];
  previousBuckets: AnalyticsBucket[];
  features: {
    name: string;
    total: number;
    previous: number;
    buckets: { date: string; value: number }[];
    previousBuckets: { date: string; value: number }[];
  }[];
  subscriptions: { id: string; name: string; users: number }[];
};
export type AdminMessage = {
  id: string;
  title: string;
  body: string;
  kind: string;
  audience: string;
  role: string | null;
  planId: string | null;
  userId: string | null;
  link: string | null;
  enabled: boolean;
  startsAt: string;
  endsAt: string | null;
  version: number;
  scope?: string;
  animeId?: string | null;
  animeTitle?: string | null;
  dismissible?: boolean;
  priority?: number;
  updatedAt: string;
  readCount?: number;
};
export type PublicMessage = {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  dismissible: boolean;
  updatedAt: string;
  expiresAt: string | null;
};
