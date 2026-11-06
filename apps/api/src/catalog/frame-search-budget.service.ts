import { HttpException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { normalizeIP } from "@fastify/rate-limit";
import {
  frameSearchBudgets,
  frameSearchLimitResponseSchema,
  type FrameSearchQuota,
} from "@animesoul/contracts";
import { AuthService, cookieToken, type AuthRequest } from "../auth/auth.service.js";
import { digest } from "../auth/security.js";
import { InternalProxyService } from "../auth/internal-proxy.service.js";

type Subject = { key: string; scope: "user" | "ip" };
type Counter = { key: string; attempts: number; windowStartedAt: Date };
const duration = frameSearchBudgets.windowSeconds * 1000;

@Injectable()
export class FrameSearchBudgetService {
  private readonly memory = new Map<string, Counter>();
  private readonly subjects = new WeakMap<AuthRequest, Promise<Subject>>();
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(InternalProxyService)
    private readonly proxy: InternalProxyService = new InternalProxyService(auth.config),
  ) {}
  subject(request: AuthRequest) {
    let task = this.subjects.get(request);
    if (!task) {
      task = (async (): Promise<Subject> => {
        if (cookieToken(request, "web")) {
          try {
            const session = await this.auth.requireSession(request);
            return { key: digest("frame:user:" + session.userId), scope: "user" };
          } catch (error) {
            if (!(error instanceof UnauthorizedException)) throw error;
          }
        }
        return {
          key: digest("frame:ip:" + normalizeIP(await this.proxy.clientIp(request))),
          scope: "ip",
        };
      })();
      this.subjects.set(request, task);
    }
    return task;
  }
  private get globalKey() {
    return digest("frame:global:" + this.auth.config.TRACE_MOE_API_KEY);
  }
  private window(counter: Counter | undefined, total: number, now: number) {
    const active = counter && counter.windowStartedAt.getTime() + duration > now;
    const used = active ? counter.attempts : 0;
    return {
      total,
      used,
      remaining: Math.max(0, total - used),
      resetAfter: active
        ? Math.max(1, Math.ceil((counter.windowStartedAt.getTime() + duration - now) / 1000))
        : frameSearchBudgets.windowSeconds,
    };
  }
  private counters(subject: Subject) {
    const keys = [subject.key, this.globalKey];
    return this.auth.config.DATABASE_URL
      ? this.auth.db.authThrottle.findMany({ where: { key: { in: keys } } })
      : Promise.resolve(
          keys.flatMap((key) => (this.memory.has(key) ? [this.memory.get(key)!] : [])),
        );
  }
  async quota(subject: Subject, provider?: FrameSearchQuota, now = Date.now()) {
    const rows = await this.counters(subject);
    const personal = this.window(
      rows.find((row) => row.key === subject.key),
      frameSearchBudgets.personal,
      now,
    );
    const global = this.window(
      rows.find((row) => row.key === this.globalKey),
      frameSearchBudgets.global,
      now,
    );
    if (provider) {
      global.remaining = Math.min(global.remaining, provider.remaining);
      global.used = global.total - global.remaining;
    }
    return frameSearchLimitResponseSchema.parse({
      total: provider?.total ?? global.total,
      used: provider?.used ?? global.used,
      remaining: provider?.remaining ?? global.remaining,
      personal: { ...personal, scope: subject.scope },
      global,
      providerAvailable: !!provider,
    });
  }
  async consume(subject: Subject, now = Date.now()) {
    const update = (rows: Counter[]) => {
      for (const [key, total, scope] of [
        [subject.key, frameSearchBudgets.personal, "personal"],
        [this.globalKey, frameSearchBudgets.global, "global"],
      ] as const) {
        const quota = this.window(
          rows.find((row) => row.key === key),
          total,
          now,
        );
        if (!quota.remaining)
          throw new HttpException(
            {
              message:
                scope === "personal"
                  ? "Ваш лимит поиска по кадру исчерпан."
                  : "Общий лимит поиска по кадру исчерпан.",
              retryAfter: quota.resetAfter,
              limitScope: scope,
            },
            429,
          );
      }
      return [subject.key, this.globalKey].map((key) => {
        const previous = rows.find((row) => row.key === key);
        const active = previous && previous.windowStartedAt.getTime() + duration > now;
        return {
          key,
          attempts: active ? previous.attempts + 1 : 1,
          windowStartedAt: active ? previous.windowStartedAt : new Date(now),
        };
      });
    };
    if (!this.auth.config.DATABASE_URL) {
      for (const [key, row] of this.memory)
        if (row.windowStartedAt.getTime() + duration <= now) this.memory.delete(key);
      const rows = update([...this.memory.values()]);
      for (const row of rows) this.memory.set(row.key, row);
      return;
    }
    // AuthThrottle is a generic hashed-key window counter. A separate namespace
    // and transaction lock keep both daily gates atomic across API processes.
    await this.auth.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(731820461)`;
      const rows = await tx.authThrottle.findMany({
        where: { key: { in: [subject.key, this.globalKey] } },
      });
      for (const row of update(rows))
        await tx.authThrottle.upsert({ where: { key: row.key }, create: row, update: row });
    });
  }
}
