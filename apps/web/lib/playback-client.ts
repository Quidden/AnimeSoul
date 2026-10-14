import { playbackSchema, type Playback } from "@animesoul/contracts";

// Public episode metadata only: never cache direct streams, credentials or progress.
export function createPlaybackClient(
  request: typeof fetch = fetch,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const cached = new Map<string, { value: Playback; until: number }>();
  const pending = new Map<string, Promise<Playback>>();
  function remember(slug: string, value: Playback) {
    if (cached.size >= 16 && !cached.has(slug)) cached.delete(cached.keys().next().value!);
    cached.set(slug, { value, until: now() + 5000 });
  }
  async function retrieve(slug: string) {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await request(`/api/anime/${encodeURIComponent(slug)}/playback`, {
          cache: "no-store",
          signal: AbortSignal.timeout(40000),
        });
      } catch (error) {
        if (attempt) throw error;
        await wait(600);
        continue;
      }
      if (!response.ok) {
        if (!attempt && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          await wait(600);
          continue;
        }
        throw new Error("Playback unavailable");
      }
      const value = playbackSchema.parse(await response.json());
      if (!attempt && value.state === "unavailable") {
        await wait(600);
        continue;
      }
      return value;
    }
  }
  return {
    peek(slug: string): Playback | undefined {
      const saved = cached.get(slug);
      return saved && saved.until > now() && !pending.has(slug) ? saved.value : undefined;
    },
    get(slug: string, fresh = false): Promise<Playback> {
      const saved = cached.get(slug);
      if (!fresh && saved && saved.until > now()) return Promise.resolve(saved.value);
      const active = pending.get(slug);
      if (!fresh && active) return active;
      cached.delete(slug);
      const loading = retrieve(slug)
        .then((value) => {
          if (pending.get(slug) === loading) {
            // Briefly carry a validated result across an episode route remount.
            remember(slug, value);
          }
          return value;
        })
        .finally(() => {
          if (pending.get(slug) === loading) pending.delete(slug);
        });
      pending.set(slug, loading);
      return loading;
    },
    carry(slug: string, value: Playback) {
      const current = cached.get(slug);
      if (
        pending.has(slug) ||
        (current && current.until > now() && current.value.revision !== value.revision)
      )
        return;
      remember(slug, value);
    },
  };
}

export const playbackClient = createPlaybackClient();
