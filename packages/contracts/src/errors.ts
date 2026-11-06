import { z } from "zod";

export const rateLimitErrorCode = "RATE_LIMITED" as const;
export const rateLimitErrorSchema = z.object({
  statusCode: z.literal(429),
  code: z.literal(rateLimitErrorCode),
  message: z.string().min(1),
  retryAfter: z.number().int().positive().max(86400),
  limitScope: z.enum(["personal", "global", "provider", "concurrency"]).optional(),
});
export type RateLimitError = z.infer<typeof rateLimitErrorSchema>;
