import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { FrameSearchService } from "./frame-search.service.js";
import { AnalyticsService } from "../admin/analytics.service.js";

@Controller("api/search/frame")
export class FrameSearchController {
  constructor(
    @Inject(FrameSearchService) private readonly frames: FrameSearchService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}
  @Get("quota") async quota() {
    const quota = await this.frames.getQuota();
    void this.analytics.quota(quota).catch(() => {
      /* Quota history must not block image search. */
    });
    return quota;
  }
  @Post()
  @HttpCode(200)
  async search(@Body() bytes: unknown) {
    const result = await this.frames.search(bytes);
    if (result.quota)
      void this.analytics.quota(result.quota).catch(() => {
        /* Best-effort quota history. */
      });
    return result;
  }
}
