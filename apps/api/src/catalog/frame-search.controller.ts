import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { FrameSearchService } from "./frame-search.service.js";
import { AnalyticsService } from "../admin/analytics.service.js";
import { FrameSearchBudgetService } from "./frame-search-budget.service.js";
import type { AuthRequest } from "../auth/auth.service.js";

@Controller("api/search/frame")
export class FrameSearchController {
  constructor(
    @Inject(FrameSearchService) private readonly frames: FrameSearchService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(FrameSearchBudgetService) private readonly budgets: FrameSearchBudgetService,
  ) {}
  @Get(["quota", "limit"]) async quota(@Req() request: AuthRequest) {
    const quota = await this.frames.getQuota().catch(() => undefined);
    if (quota)
      void this.analytics.quota(quota).catch(() => {
        /* Quota history must not block image search. */
      });
    return this.budgets.quota(await this.budgets.subject(request), quota);
  }
  @Post()
  @HttpCode(200)
  async search(@Body() bytes: unknown, @Req() request: AuthRequest) {
    const subject = await this.budgets.subject(request);
    const result = await this.frames.search(bytes, () => this.budgets.consume(subject));
    if (result.quota)
      void this.analytics.quota(result.quota).catch(() => {
        /* Best-effort quota history. */
      });
    return { ...result, quota: await this.budgets.quota(subject, result.quota) };
  }
}
