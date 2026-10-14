import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  adultPreferenceSchema,
  commentInputSchema,
  contentQuerySchema,
  deleteContentSchema,
  postInputSchema,
} from "@animesoul/contracts";
import { z } from "zod";
import { parse } from "../auth/auth.controller.js";
import type { AuthRequest } from "../auth/auth.service.js";
import { ContentService } from "./content.service.js";
@Controller("api/account/content")
export class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}
  @Get("posts") posts(@Req() req: AuthRequest, @Query() q: unknown) {
    return this.content.posts(req, parse(contentQuerySchema, q));
  }
  @Get("posts/:id") post(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.content.post(
      req,
      parse(
        z.uuid().transform((v) => v.toLowerCase()),
        id,
      ),
    );
  }
  @Post("posts") writePost(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.content.writePost(req, parse(postInputSchema, body));
  }
  @Post("posts/delete") removePost(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.content.remove(req, parse(deleteContentSchema, body).id, "post");
  }
  @Get("comments") comments(@Req() req: AuthRequest, @Query() q: unknown) {
    return this.content.comments(req, parse(contentQuerySchema, q));
  }
  @Post("comments") writeComment(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.content.writeComment(req, parse(commentInputSchema, body));
  }
  @Post("comments/delete") removeComment(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.content.remove(req, parse(deleteContentSchema, body).id, "comment");
  }
  @Post("preferences") preference(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.content.preference(req, parse(adultPreferenceSchema, body).enabled);
  }
}
