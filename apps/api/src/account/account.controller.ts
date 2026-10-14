import { Body, Controller, Get, Inject, Post, Req, Query } from "@nestjs/common";
import {
  folderEditSchema,
  folderEntrySchema,
  libraryEditSchema,
  profileEditSchema,
  progressEditSchema,
  ratingEditSchema,
  playerPreferencesEditSchema,
  favoriteDubbingSchema,
  animeDubbingSchema,
} from "@animesoul/contracts";
import { z } from "zod";
import { parse } from "../auth/auth.controller.js";
import type { AuthRequest } from "../auth/auth.service.js";
import { AccountService } from "./account.service.js";
@Controller("api/account")
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}
  @Get("player") player(@Req() request: AuthRequest, @Query("animeId") animeId?: string) {
    return this.account.playerState(
      request,
      animeId === undefined ? undefined : parse(z.uuid(), animeId),
    );
  }
  @Post("player/preferences") editPlayer(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.editPlayer(request, parse(playerPreferencesEditSchema, body));
  }
  @Post("player/favorite") favoriteDubbing(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.editPlayer(request, parse(favoriteDubbingSchema, body));
  }
  @Post("player/dubbing") animeDubbing(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.animeDubbing(request, parse(animeDubbingSchema, body));
  }
  @Get("profile") profile(@Req() request: AuthRequest) {
    return this.account.profile(request);
  }
  @Post("profile") editProfile(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.editProfile(request, parse(profileEditSchema, body));
  }
  @Get("library") library(@Req() request: AuthRequest) {
    return this.account.library(request);
  }
  @Post("library") editLibrary(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.editLibrary(request, parse(libraryEditSchema, body));
  }
  @Post("ratings") rating(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.rating(request, parse(ratingEditSchema, body));
  }
  @Post("folders") folder(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.folder(request, parse(folderEditSchema, body));
  }
  @Post("folders/delete") deleteFolder(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.deleteFolder(request, parse(z.object({ id: z.uuid() }), body).id);
  }
  @Post("folders/entry") folderEntry(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.folderEntry(request, parse(folderEntrySchema, body));
  }
  @Post("progress") progress(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.account.progress(request, parse(progressEditSchema, body));
  }
}
