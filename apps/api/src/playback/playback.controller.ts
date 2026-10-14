import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ProvidersService } from "../providers/providers.service.js";
import { PlaybackService } from "./playback.service.js";
import { DirectStreamService } from "./direct-stream.service.js";
import { Req } from "@nestjs/common";
import type { AuthRequest } from "../auth/auth.service.js";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";
@Controller("api/playback")
export class PlaybackRevisionController {
  constructor(@Inject(ProvidersService) private readonly providers: ProvidersService) {}
  @Get("revision")
  async revision() {
    return { revision: await this.providers.revision() };
  }
}
@Controller("api/anime")
export class PlaybackController {
  constructor(
    @Inject(PlaybackService) private readonly playback: PlaybackService,
    @Inject(DirectStreamService) private readonly direct: DirectStreamService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}
  @Get(":slug/stream")
  async stream(
    @Param("slug") slug: string,
    @Query("source") source: string,
    @Req() request: AuthRequest,
  ) {
    if (
      typeof slug !== "string" ||
      !/^[a-z0-9-]{1,160}$/.test(slug) ||
      typeof source !== "string" ||
      !/^[a-f0-9]{24}$/.test(source)
    )
      throw new BadRequestException();
    return this.direct.resolve(slug, source, request.ip, await this.subscriptions.viewer(request));
  }
  @Get(":slug/playback")
  async find(@Param("slug") slug: string, @Query("provider") mode: unknown = "auto") {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    if (mode !== "auto") throw new BadRequestException("Invalid playback provider.");
    const playback = await this.playback.find(slug);
    if (!playback) throw new NotFoundException();
    return playback;
  }
}
