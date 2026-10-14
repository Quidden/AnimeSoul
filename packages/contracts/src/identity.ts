import { z } from "zod";
import { passwordSchema } from "./account.js";
export const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
export const accountTokenSchema = z.string().regex(/^[\w-]{43}$/);
export const emailRequestSchema = z.object({ email: emailSchema });
export const emailChangeSchema = emailRequestSchema.extend({ password: passwordSchema });
export const emailConfirmSchema = z.object({ token: accountTokenSchema });
export const resetPasswordSchema = emailConfirmSchema.extend({ password: passwordSchema });
export const googleStartSchema = z.object({
  intent: z.enum(["login", "link"]),
  password: passwordSchema.optional(),
});
export const identityOptionsSchema = z.object({
  google: z.boolean(),
  email: z.boolean(),
  localMail: z.boolean(),
});
export type IdentityOptions = z.infer<typeof identityOptionsSchema>;
