import { z } from "zod";
import { frameSearchResultSchema, type FrameSearchResult } from "@animesoul/contracts";

export const frameHistoryKey = "animesoul.frame-search-history.v1";
export const textHistoryKey = "animesoul.search-history.v1";
const historySchema = z
  .array(
    z.object({
      id: z.string().min(1).max(100),
      searchedAt: z.number().finite().nonnegative().max(4_102_444_800_000),
      result: frameSearchResultSchema,
    }),
  )
  .max(20);
export type FrameHistoryEntry = z.infer<typeof historySchema>[number];
export function parseFrameHistory(value: string | null): FrameHistoryEntry[] {
  if (value && value.length > 256000) return [];
  try {
    const parsed = historySchema.safeParse(JSON.parse(value ?? "[]"));
    return parsed.success
      ? parsed.data.map((entry) => ({ ...entry, result: withoutPreviews(entry.result) }))
      : [];
  } catch {
    return [];
  }
}
function withoutPreviews(result: FrameSearchResult): FrameSearchResult {
  return {
    provider: "trace.moe",
    matches: result.matches.map((match) => ({
      ...match,
      image: null,
      video: null,
      watch: match.watch ?? null,
    })),
  };
}
export function appendFrameHistory(
  history: FrameHistoryEntry[],
  result: FrameSearchResult,
  searchedAt: number,
  id: string,
) {
  if (!result.matches.length) return history;
  const best = result.matches[0]!;
  const previous = history.filter(({ result: old }) => {
    const match = old.matches[0];
    return (
      !match ||
      match.anilistId !== best.anilistId ||
      match.episode !== best.episode ||
      Math.floor(match.timestamp) !== Math.floor(best.timestamp)
    );
  });
  return [{ id, searchedAt, result: withoutPreviews(result) }, ...previous].slice(0, 20);
}
export function parseTextHistory(value: string | null): string[] {
  if (value && value.length > 10000) return [];
  try {
    const parsed = z
      .array(z.string().trim().min(1).max(240))
      .max(10)
      .safeParse(JSON.parse(value ?? "[]"));
    return parsed.success ? [...new Set(parsed.data)] : [];
  } catch {
    return [];
  }
}
export function appendTextHistory(history: string[], query: string) {
  const value = query.trim().slice(0, 240);
  return value ? [value, ...history.filter((item) => item !== value)].slice(0, 10) : history;
}
