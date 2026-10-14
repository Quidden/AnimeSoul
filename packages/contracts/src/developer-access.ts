import { z } from "zod";

export const developerAccessModeSchema = z.enum(["actual", "guest", "user", "trial", "subscriber"]);
export type DeveloperAccessMode = z.infer<typeof developerAccessModeSchema>;
export const developerAccessEditSchema = z.object({ mode: developerAccessModeSchema }).strict();
export const developerAccessSchema = z.object({
  mode: developerAccessModeSchema,
  role: z.enum(["owner", "admin"]),
  csrfToken: z.string(),
});
export type DeveloperAccess = z.infer<typeof developerAccessSchema>;
export function developerRole(roles: readonly string[]) {
  return roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : null;
}
