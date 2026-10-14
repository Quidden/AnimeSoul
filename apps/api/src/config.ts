import { z } from "zod";
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8020),
  API_HOST: z.string().default("127.0.0.1"),
  SITE_URL: z.url().default("http://localhost:8021"),
  ADMIN_URL: z.url().default("http://localhost:8022"),
  PROFILE_MEDIA_DIR: z.string().max(4096).default(""),
  TRACE_MOE_API_KEY: z.string().max(512).default(""),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^(?:[a-f0-9]{64})?$/)
    .default(""),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "A PostgreSQL URL is required.",
    )
    .optional(),
  DEMO_CATALOG: z.enum(["true", "false"]).default("false"),
  ALLOW_YUMMY: z.enum(["true", "false"]).default("false"),
  ALLOW_KODIK: z.enum(["true", "false"]).default("false"),
  YUMMY_TOKEN: z.string().max(512).default(""),
  KODIK_TOKEN: z.string().max(512).default(""),
  ALLOW_KODIK_DIRECT: z.enum(["true", "false"]).default("false"),
  KODIK_PRIVATE_KEY: z.string().max(512).default(""),
  KODIK_MEDIA_HOSTS: z.string().max(2048).default(""),
  KODIK_VIEWER_IP: z.string().max(45).default(""),
  GOOGLE_CLIENT_ID: z.string().max(512).default(""),
  GOOGLE_CLIENT_SECRET: z.string().max(512).default(""),
  MAIL_MODE: z.enum(["disabled", "file", "smtp"]).default("disabled"),
  SMTP_HOST: z.string().max(254).default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().max(254).default(""),
  SMTP_PASSWORD: z.string().max(512).default(""),
  SMTP_FROM: z.string().max(254).default(""),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = schema.parse(env);
  if (config.NODE_ENV === "production" && config.KODIK_VIEWER_IP)
    throw new Error("A fixed viewer IP is forbidden in production.");
  if (Boolean(config.GOOGLE_CLIENT_ID) !== Boolean(config.GOOGLE_CLIENT_SECRET))
    throw new Error("Google requires both client ID and secret.");
  if (config.MAIL_MODE === "smtp" && (!config.SMTP_HOST || !config.SMTP_FROM))
    throw new Error("SMTP requires host and sender.");
  if (config.NODE_ENV === "production" && config.DEMO_CATALOG === "true")
    throw new Error("Development catalog is forbidden in production.");
  if (config.NODE_ENV === "production" && !config.DATABASE_URL)
    throw new Error("Production requires a database.");
  if (config.NODE_ENV === "production") {
    if (config.MAIL_MODE === "file")
      throw new Error("Local mail files are forbidden in production.");
    const site = new URL(config.SITE_URL);
    const admin = new URL(config.ADMIN_URL);
    if (
      site.protocol !== "https:" ||
      admin.protocol !== "https:" ||
      site.hostname === admin.hostname
    )
      throw new Error("Production requires separate HTTPS site and admin hosts.");
    if (!config.MFA_ENCRYPTION_KEY) throw new Error("Production requires an MFA encryption key.");
  }
  return config;
}
export type Configuration = ReturnType<typeof readConfig>;
export const CONFIG = Symbol("CONFIG");
