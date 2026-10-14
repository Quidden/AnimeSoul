import { Body, Controller, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { profileMediaEditSchema } from "@animesoul/contracts";
import { parse } from "../auth/auth.controller.js";
import type { AuthRequest, AuthReply } from "../auth/auth.service.js";
import { ProfileMediaService } from "./profile-media.service.js";

@Controller("api/account/profile/media")
export class ProfileMediaController {
  constructor(@Inject(ProfileMediaService) private readonly media: ProfileMediaService) {}
  @Post() change(@Body() body: unknown, @Req() request: AuthRequest) {
    const input = parse(profileMediaEditSchema, body);
    return this.media.change(request, input.kind, input.value);
  }
  @Post("avatar") uploadAvatar(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.media.upload(request, "avatar", body);
  }
  @Post("banner") uploadBanner(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.media.upload(request, "banner", body);
  }
}
@Controller("api/profile-media")
export class ProfileMediaReadController {
  constructor(@Inject(ProfileMediaService) private readonly media: ProfileMediaService) {}
  @Get(":userId/:kind/:filename") async read(
    @Param("userId") userId: string,
    @Param("kind") kind: string,
    @Param("filename") filename: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    const result = await this.media.read(
      request,
      `/api/profile-media/${userId}/${kind}/${filename}`,
    );
    reply.header("Content-Type", result.type);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Robots-Tag", "noindex, nofollow");
    reply.header("Vary", "Cookie");
    return result.bytes;
  }
}
