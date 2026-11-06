import { rateLimitErrorSchema } from "@animesoul/contracts";

// "через 5 мин", "через 2 ч": a wait the reader can act on, rounded up so it is never too short.
export function waitLabel(seconds: number) {
  if (seconds >= 3600) return `через ${Math.ceil(seconds / 3600)} ч`;
  if (seconds >= 60) return `через ${Math.ceil(seconds / 60)} мин`;
  return `через ${Math.max(1, Math.ceil(seconds))} сек`;
}

// The API answers 429 with { code: "RATE_LIMITED", retryAfter }; anything else is not a limit.
export function rateLimitWait(body: unknown): number | null {
  const parsed = rateLimitErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.retryAfter : null;
}
