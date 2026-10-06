import { z } from "zod";
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8020),
  API_HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "A PostgreSQL URL is required.",
    )
    .optional(),
  DEMO_CATALOG: z.enum(["true", "false"]).default("false"),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = schema.parse(env);
  if (config.NODE_ENV === "production" && config.DEMO_CATALOG === "true")
    throw new Error("Development catalog is forbidden in production.");
  if (config.NODE_ENV === "production" && !config.DATABASE_URL)
    throw new Error("Production requires a database.");
  return config;
}
export type Configuration = ReturnType<typeof readConfig>;
export const CONFIG = Symbol("CONFIG");
