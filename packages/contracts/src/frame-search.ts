import { z } from "zod";

export const frameSearchLimits = {
  bytes: 5 * 1024 * 1024,
  dimension: 4096,
  pixels: 16_777_216,
} as const;
export const frameSearchAccept = ".jpg,.jpeg,.png,.webp,.gif";
export const frameSearchTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const frameSearchBudgets = { personal: 10, global: 100, windowSeconds: 86400 } as const;
export const frameSearchWindowSchema = z.object({
  total: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAfter: z.number().int().positive().max(frameSearchBudgets.windowSeconds),
});
export const frameSearchQuotaSchema = z.object({
  total: z.number().int().positive().max(10_000_000),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  personal: frameSearchWindowSchema.extend({ scope: z.enum(["user", "ip"]) }).optional(),
  global: frameSearchWindowSchema.optional(),
  providerAvailable: z.boolean().optional(),
});
export const frameSearchLimitResponseSchema = frameSearchQuotaSchema.required({
  personal: true,
  global: true,
  providerAvailable: true,
});
export type FrameSearchQuota = z.infer<typeof frameSearchQuotaSchema>;
export function tracePreviewUrl(value: unknown, kind: "image" | "video"): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^(?:api|media\d*)\.trace\.moe$/.test(url.hostname) &&
      url.pathname.startsWith(`/${kind}/`)
      ? value
      : null;
  } catch {
    return null;
  }
}
export const frameSearchMatchSchema = z.object({
  anilistId: z.number().int().positive(),
  title: z.string().min(1).max(500),
  episode: z.string().max(100).nullable(),
  season: z.string().max(20).nullable().default(null),
  timestamp: z.number().finite().nonnegative(),
  similarity: z.number().min(0).max(1),
  isAdult: z.boolean(),
  image: z
    .string()
    .refine((url) => tracePreviewUrl(url, "image") === url)
    .nullable(),
  video: z
    .string()
    .refine((url) => tracePreviewUrl(url, "video") === url)
    .nullable(),
  anime: z
    .object({ slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().max(500) })
    .nullable(),
  watch: z
    .object({
      episodeId: z.uuid(),
      season: z.string().min(1).max(30),
      episode: z.string().min(1).max(30),
    })
    .nullable()
    .default(null),
});
export const frameSearchResultSchema = z.object({
  provider: z.literal("trace.moe"),
  matches: z.array(frameSearchMatchSchema).max(5),
  quota: frameSearchQuotaSchema.optional(),
});
export type FrameSearchMatch = z.infer<typeof frameSearchMatchSchema>;
export type FrameSearchResult = z.infer<typeof frameSearchResultSchema>;
