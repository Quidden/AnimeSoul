import { Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { publicMediaUrl, streamSchema, type Stream } from "@animesoul/contracts";
import { CONFIG, type Configuration } from "../config.js";
import { UPSTREAM_FETCH, type UpstreamFetch } from "../providers/provider-http.js";
import { ProvidersService } from "../providers/providers.service.js";
import { record } from "../providers/normalizers.js";
import { PlaybackService } from "./playback.service.js";
import {
  SubscriptionsService,
  type SubscriptionViewer,
} from "../subscriptions/subscriptions.service.js";
function publicIPv4(value: string) {
  if (isIP(value) !== 4) return false;
  const [a = 0, b = 0] = value.split(".").map(Number);
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
}
@Injectable()
export class DirectStreamService {
  private active = 0;
  private localIp: { value: string; until: number } | undefined;
  constructor(
    @Inject(CONFIG) private readonly config: Configuration,
    @Inject(UPSTREAM_FETCH) private readonly request: UpstreamFetch,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
    @Inject(PlaybackService) private readonly playback: PlaybackService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}
  private async ip(actual: string) {
    if (publicIPv4(actual)) return actual;
    if (this.config.NODE_ENV === "production") throw new Error("Viewer address unavailable.");
    if (publicIPv4(this.config.KODIK_VIEWER_IP)) return this.config.KODIK_VIEWER_IP;
    if (this.localIp && this.localIp.until > Date.now()) return this.localIp.value;
    const response = await this.request("https://api.ipify.org?format=json", {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 128)
      throw new Error();
    const body = await response.text();
    if (body.length > 128) throw new Error();
    const value = record(JSON.parse(body)).ip;
    if (typeof value !== "string" || !publicIPv4(value)) throw new Error();
    this.localIp = { value, until: Date.now() + 600000 };
    return value;
  }
  async resolve(
    slug: string,
    sourceId: string,
    actualIp: string,
    userId?: SubscriptionViewer,
  ): Promise<Stream> {
    const fallback: Stream = { mode: "embed" };
    if (
      this.config.ALLOW_KODIK_DIRECT !== "true" ||
      !this.config.KODIK_PRIVATE_KEY ||
      this.active >= 4
    )
      return fallback;
    if (!(await this.subscriptions.access(userId)).nativeAccess) return fallback;
    // Authorization yields; other requests may have filled the available slots.
    if (this.active >= 4) return fallback;
    this.active++;
    try {
      if ((await this.providers.state("kodik")) !== "enabled") return fallback;
      const manifest = await this.playback.find(slug);
      const source = manifest?.sources.find((item) => item.id === sourceId);
      if (!source) return fallback;
      const embed = new URL(source.embedUrl);
      if (
        !["kodik.info", "kodik.cc", "kodik.biz", "kodikplayer.com", "kodikplay.com"].some(
          (host) => embed.hostname === host || embed.hostname.endsWith("." + host),
        ) ||
        !/^\/(?:seria|video|movie)\/[^/]+\/[^/]+\/[^/]+\/?$/.test(embed.pathname)
      )
        return fallback;
      const link = "//" + embed.host + embed.pathname + embed.search;
      const ip = await this.ip(actualIp);
      const expires = new Date(Math.floor(Date.now() / 3600000) * 3600000 + 2 * 3600000);
      const deadline = expires.toISOString().slice(0, 13).replaceAll(/[-T]/g, "");
      const signature = createHmac("sha256", this.config.KODIK_PRIVATE_KEY)
        .update(`${link}:${ip}:${deadline}`)
        .digest("hex");
      const url = new URL("https://kodikres.com/api/video-links");
      url.search = new URLSearchParams({
        link,
        p: this.config.KODIK_TOKEN,
        ip,
        d: deadline,
        s: signature,
        auto_proxy: "true",
      }).toString();
      const response = await this.request(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok || !response.body) return fallback;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            return fallback;
          }
          chunks.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      const payload = record(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
      if (payload.error) return fallback;
      const hosts = this.config.KODIK_MEDIA_HOSTS.split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);
      const sources: { quality: number; src: string; type: "hls" | "video" }[] = [];
      for (const [qualityKey, variants] of Object.entries(record(payload.links ?? payload.Links))) {
        const quality = Number(qualityKey);
        if (!Number.isInteger(quality) || quality < 1 || quality > 4320) continue;
        for (const variant of Array.isArray(variants) ? variants : [variants]) {
          const item = record(variant),
            raw = typeof variant === "string" ? variant : (item.Src ?? item.src);
          if (typeof raw !== "string") continue;
          const src = raw.startsWith("//") ? "https:" + raw : raw;
          if (
            !publicMediaUrl(src) ||
            this.providers.hidesCredential(src) ||
            src.includes(this.config.KODIK_PRIVATE_KEY)
          )
            continue;
          const host = new URL(src).hostname;
          // Media URLs come only from the fixed authenticated API; this server never fetches them.
          if (hosts.length && !hosts.some((root) => host === root || host.endsWith("." + root)))
            continue;
          sources.push({
            quality,
            src,
            type:
              /\.m3u8$/i.test(new URL(src).pathname) ||
              /hls/i.test(String(item.Type ?? item.type ?? ""))
                ? "hls"
                : "video",
          });
        }
      }
      if (
        (await this.providers.state("kodik")) !== "enabled" ||
        !sources.length ||
        !(await this.subscriptions.access(userId)).nativeAccess
      )
        return fallback;
      sources.sort((a, b) => b.quality - a.quality);
      return streamSchema.parse({
        mode: "direct",
        expiresAt: expires.toISOString(),
        sources: sources.slice(0, 30),
      });
    } catch {
      return fallback;
    } finally {
      this.active--;
    }
  }
}
