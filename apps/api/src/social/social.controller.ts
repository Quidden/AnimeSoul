import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  peopleQuerySchema,
  socialActionSchema,
  socialListQuerySchema,
  usernameSchema,
} from "@animesoul/contracts";
import { z } from "zod";
import { parse } from "../auth/auth.controller.js";
import type { AuthRequest } from "../auth/auth.service.js";
import { SocialService } from "./social.service.js";
@Controller("api/account")
export class SocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}
  @Get("social") list(@Req() request: AuthRequest, @Query() query: unknown) {
    return this.social.list(request, parse(socialListQuerySchema, query));
  }
  @Post("social") change(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.social.change(request, parse(socialActionSchema, body));
  }
  @Get("social/search") search(@Req() request: AuthRequest, @Query() query: unknown) {
    return this.social.search(request, parse(peopleQuerySchema, query));
  }
  @Get("social/:id") relationship(@Req() request: AuthRequest, @Param("id") id: string) {
    return this.social.relationship(
      request,
      parse(
        z.uuid().transform((value) => value.toLowerCase()),
        id,
      ),
    );
  }
  @Get("profiles/:username") profile(
    @Req() request: AuthRequest,
    @Param("username") username: string,
  ) {
    return this.social.profile(request, parse(usernameSchema, username));
  }
  @Get("profiles/:username/friends") friends(
    @Req() request: AuthRequest,
    @Param("username") username: string,
    @Query() query: unknown,
  ) {
    const input = parse(z.object({ after: z.uuid().optional() }).strict(), query);
    return this.social.profile(request, parse(usernameSchema, username), input.after, true);
  }
}
