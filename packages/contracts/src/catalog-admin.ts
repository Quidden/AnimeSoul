import { z } from "zod";
import { usernameSchema } from "./account.js";
export const reserveAccessSchema = z.object({
  username: usernameSchema,
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export const providerNameSchema = z.enum(["yummy", "kodik"]);
export const auditReasonSchema = z.string().trim().min(3).max(500);
export const providerSwitchSchema = z.object({
  provider: providerNameSchema,
  enabled: z.boolean(),
  reason: auditReasonSchema,
});
export const catalogStartSchema = z.object({ reason: auditReasonSchema });
export const catalogControlSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["resume", "cancel"]),
  reason: auditReasonSchema,
});
export const mappingResolveSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  decision: z.enum(["keep-existing", "use-incoming"]),
  reason: auditReasonSchema,
});
export const catalogJobSchema = z.object({
  id: z.string().uuid(),
  provider: providerNameSchema,
  status: z.enum(["queued", "running", "paused", "completed", "failed", "cancelled"]),
  offset: z.number(),
  strategy: z.string(),
  upperBound: z.number().nullable(),
  pages: z.number(),
  imported: z.number(),
  rejected: z.number(),
  conflicts: z.number(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
const identity = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  year: z.number(),
});
export const catalogAdminSchema = z.object({
  access: z.object({
    canSwitchKodik: z.boolean(),
    canSwitchReserve: z.boolean(),
    canManageCatalog: z.boolean(),
    canDelegateReserve: z.boolean(),
  }),
  reserveManagers: z.array(z.object({ username: z.string() })),
  providers: z.array(
    z.object({
      name: providerNameSchema,
      enabled: z.boolean(),
      environmentAllows: z.boolean(),
      hasCredentials: z.boolean(),
      state: z.enum(["enabled", "disabled", "environment-blocked", "missing-credentials", "error"]),
    }),
  ),
  jobs: z.array(catalogJobSchema),
  conflicts: z.array(
    z.object({
      id: z.string().uuid(),
      provider: z.string(),
      externalId: z.string(),
      previousExternalId: z.string().nullable(),
      version: z.number(),
      incoming: identity,
      existing: identity.nullable(),
    }),
  ),
  totalConflicts: z.number(),
  page: z.number(),
  pages: z.number(),
});
export type CatalogAdmin = z.infer<typeof catalogAdminSchema>;
