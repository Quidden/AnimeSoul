import { createHash } from "node:crypto";

export type PublicResponse = { body: string; etag: string };
type Entry = PublicResponse & { expires: number; bytes: number };

/** Only public DTOs enter this cache; every lookup first checks a DB visibility snapshot. */
export class PublicResponseCache {
  private revision = "";
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<PublicResponse | null>>();
  private bytes = 0;
  constructor(
    private readonly lifetime = 30000,
    private readonly capacity = 32 * 1024 * 1024,
  ) {}
  async read(
    revision: string,
    key: string,
    load: () => Promise<unknown>,
  ): Promise<PublicResponse | null> {
    if (revision !== this.revision) {
      this.entries.clear();
      this.bytes = 0;
      this.revision = revision;
    }
    const saved = this.entries.get(key);
    if (saved && saved.expires > Date.now()) return saved;
    if (saved) this.remove(key);
    const pendingKey = revision + ":" + key;
    const running = this.pending.get(pendingKey);
    if (running) return running;
    const task = (async () => {
      const value = await load();
      if (value === null || value === undefined) return null;
      const body = JSON.stringify(value);
      const result = {
        body,
        etag: '"' + createHash("sha256").update(body).digest("base64url") + '"',
      };
      const bytes = Buffer.byteLength(body);
      if (revision === this.revision && bytes <= this.capacity) {
        while (
          this.entries.size &&
          (this.bytes + bytes > this.capacity || this.entries.size >= 128)
        )
          this.remove(this.entries.keys().next().value!);
        this.entries.set(key, { ...result, bytes, expires: Date.now() + this.lifetime });
        this.bytes += bytes;
      }
      return result;
    })();
    // Bound bookkeeping under bursts of distinct slugs; excess loads are never retained in flight.
    if (this.pending.size < 128) this.pending.set(pendingKey, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(pendingKey) === task) this.pending.delete(pendingKey);
    }
  }
  private remove(key: string) {
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
  }
}

export function matchesEtag(value: string | string[] | undefined, etag: string) {
  return (
    typeof value === "string" &&
    value.split(",").some((part) => part.trim() === "*" || part.trim().replace(/^W\//, "") === etag)
  );
}
