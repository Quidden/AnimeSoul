export type UpstreamFetch = typeof fetch;
export const UPSTREAM_FETCH = Symbol("UPSTREAM_FETCH");
type Provider = "yummy" | "kodik";
type Entry = { value: unknown; until: number };
export class ProviderHttpError extends Error {
  constructor(
    readonly code: "rate-limited" | "authentication" | "request-failed",
    readonly retryMs = 0,
  ) {
    super("Provider request failed.");
  }
}

/** Bounded, short-lived server cache. Credentials never enter errors or cache keys. */
export class ProviderHttp {
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<
    string,
    { controller: AbortController; task: Promise<unknown> }
  >();
  constructor(private readonly request: UpstreamFetch) {}
  clear(provider: Provider) {
    for (const key of this.cache.keys()) if (key.startsWith(provider + ":")) this.cache.delete(key);
    for (const [key, entry] of this.pending)
      if (key.startsWith(provider + ":")) entry.controller.abort();
  }
  async get(
    provider: Provider,
    route: string,
    params: Record<string, string>,
    token: string,
  ): Promise<unknown> {
    const query = new URLSearchParams(params);
    query.sort();
    const key = provider + ":" + route + "?" + query;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const existing = this.pending.get(key);
    if (existing) return existing.task;
    if (this.pending.size >= 8) throw new Error("Provider is busy.");
    const controller = new AbortController();
    const task = this.load(provider, route, query, token, controller)
      .then((value) => {
        if (controller.signal.aborted) throw new Error("Provider request cancelled.");
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { value, until: Date.now() + 60000 });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, { controller, task });
    return task;
  }
  private async load(
    provider: Provider,
    route: string,
    query: URLSearchParams,
    token: string,
    controller: AbortController,
  ) {
    const base = provider === "yummy" ? "https://api.yani.tv" : "https://kodik-api.com";
    const url = new URL(route, base);
    if (provider === "kodik") query.set("token", token);
    url.search = query.toString();
    try {
      const response = await this.request(url, {
        headers:
          provider === "yummy"
            ? { "X-Application": token, Lang: "ru", Accept: "application/json" }
            : { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (response.status === 429) {
        const retry = response.headers.get("retry-after") ?? "";
        const milliseconds = /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now();
        throw new ProviderHttpError(
          "rate-limited",
          Number.isFinite(milliseconds) ? Math.max(1000, Math.min(600000, milliseconds)) : 60000,
        );
      }
      if ([401, 403].includes(response.status)) throw new ProviderHttpError("authentication");
      if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 4 * 1024 * 1024)
        throw new Error("Provider response rejected.");
      if (!response.body) throw new Error("Provider response is empty.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Provider response too large.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
    } catch (error) {
      throw error instanceof ProviderHttpError ? error : new ProviderHttpError("request-failed");
    }
  }
}
