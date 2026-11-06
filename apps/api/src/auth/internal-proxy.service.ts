import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { normalizeIP } from "@fastify/rate-limit";
import { CONFIG, type Configuration } from "../config.js";
import type { AuthRequest } from "./auth.service.js";

export const INTERNAL_PROXY_LOOKUP = Symbol("INTERNAL_PROXY_LOOKUP");
type ProxyLookup = (host: string) => Promise<{ address: string }[]>;
const resolveHost: ProxyLookup = (host) => lookup(host, { all: true, verbatim: true });
const hash = (value: string) => createHash("sha256").update(value).digest();
const literal = (value: unknown): value is string =>
  typeof value === "string" && isIP(value) !== 0 && !value.includes("%");

/** This opt-in identity channel never changes Fastify's socket IP or trustProxy setting. */
@Injectable()
export class InternalProxyService {
  private readonly secret: Buffer | undefined;
  private readonly peers: Set<string>;
  private resolving: Promise<Set<string>> | undefined;
  constructor(
    @Inject(CONFIG) private readonly config: Configuration,
    @Optional()
    @Inject(INTERNAL_PROXY_LOOKUP)
    private readonly lookupHost: ProxyLookup = resolveHost,
  ) {
    this.secret = config.INTERNAL_PROXY_SECRET ? hash(config.INTERNAL_PROXY_SECRET) : undefined;
    this.peers = new Set(
      (config.INTERNAL_PROXY_TRUSTED_IPS ?? []).map((value) => normalizeIP(value, 128)),
    );
  }
  async clientIp(request: AuthRequest): Promise<string> {
    const forwarded = request.headers["x-animesoul-client-ip"];
    const secret = request.headers["x-animesoul-proxy-secret"];
    if (
      !this.secret ||
      !literal(forwarded) ||
      typeof secret !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(secret) ||
      !timingSafeEqual(hash(secret), this.secret) ||
      !literal(request.ip)
    )
      return request.ip;
    const peer = normalizeIP(request.ip, 128);
    if (!this.peers.has(peer) && !(await this.resolvedPeers()).has(peer)) return request.ip;
    return normalizeIP(forwarded, 128);
  }
  private async resolvedPeers() {
    if (!this.config.INTERNAL_PROXY_TRUSTED_HOSTS?.length) return new Set<string>();
    // Coalesce only concurrent lookups. Do not keep stale authorization when a
    // recreated web container releases an address that Docker can reuse.
    if (this.resolving) return this.resolving;
    const task = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([
          Promise.allSettled(
            this.config.INTERNAL_PROXY_TRUSTED_HOSTS.map(async (host) => this.lookupHost(host)),
          ),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), 1000);
          }),
        ]);
        return new Set(
          (results ?? []).flatMap((result) =>
            result.status === "fulfilled"
              ? result.value
                  .filter((value) => literal(value.address))
                  .map((value) => normalizeIP(value.address, 128))
              : [],
          ),
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    this.resolving = task;
    try {
      return await task;
    } finally {
      if (this.resolving === task) this.resolving = undefined;
    }
  }
}
