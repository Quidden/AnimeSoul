import { z } from "zod";
export function publicMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      /^[a-z0-9.-]+$/i.test(url.hostname) &&
      url.hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      !/\.(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) &&
      !url.hash &&
      value.length <= 4096
    );
  } catch {
    return false;
  }
}
export const streamSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("embed") }),
  z.object({
    mode: z.literal("direct"),
    expiresAt: z.string(),
    sources: z
      .array(
        z.object({
          quality: z.number().int().min(1).max(4320),
          type: z.enum(["hls", "video"]),
          src: z.string().refine(publicMediaUrl),
        }),
      )
      .min(1)
      .max(30),
  }),
]);
export type Stream = z.infer<typeof streamSchema>;
