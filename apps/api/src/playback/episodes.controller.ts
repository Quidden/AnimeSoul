import { Controller, Get, Post, Body, Param, Req, Inject, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { playbackSessionStartSchema, playbackProgressSchema } from "@animesoul/contracts";
import { parse } from "../auth/auth.controller.js";
import type { AuthRequest } from "../auth/auth.service.js";
import { EpisodeService } from "./episode.service.js";
import { ProgressService } from "./progress.service.js";
const slugSchema = z.string().regex(/^[a-z0-9-]{1,160}$/);
@Controller("api/anime")
export class EpisodesController {
  constructor(@Inject(EpisodeService) private readonly episodes: EpisodeService) {}
  @Get(":slug/episodes") async list(@Param("slug") slug: string) {
    const result = await this.episodes.list(parse(slugSchema, slug));
    if (!result) throw new NotFoundException();
    return result;
  }
  @Get(":slug/episodes/:id") async find(@Param("slug") slug: string, @Param("id") id: string) {
    const result = await this.episodes.find(parse(slugSchema, slug), parse(z.uuid(), id));
    if (!result) throw new NotFoundException();
    return result;
  }
}
@Controller("api/sitemap/episodes")
export class EpisodeSitemapController {
  constructor(@Inject(EpisodeService) private readonly episodes: EpisodeService) {}
  @Get(":bucket") sitemap(@Param("bucket") bucket: string) {
    return this.episodes.sitemap(parse(z.coerce.number().int().min(0).max(255), bucket));
  }
}
@Controller("api/account/playback")
export class ProgressController {
  constructor(@Inject(ProgressService) private readonly progress: ProgressService) {}
  @Get(":animeId") saved(@Req() request: AuthRequest, @Param("animeId") id: string) {
    return this.progress.saved(request, parse(z.uuid(), id));
  }
  @Post("session") start(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.progress.start(request, parse(playbackSessionStartSchema, body).episodeId);
  }
  @Post("progress") save(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.progress.save(request, parse(playbackProgressSchema, body));
  }
}
