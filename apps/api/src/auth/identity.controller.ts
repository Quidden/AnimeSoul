import { Body, Controller, Get, Inject, Post, Query, Req, Res } from "@nestjs/common";
import {
  emailRequestSchema,
  emailChangeSchema,
  emailConfirmSchema,
  resetPasswordSchema,
  googleStartSchema,
} from "@animesoul/contracts";
import { parse } from "./auth.controller.js";
import { AuthService, type AuthReply, type AuthRequest } from "./auth.service.js";
import { AccountEmailService } from "./account-email.service.js";
import { GoogleAuthService } from "./google-auth.service.js";
@Controller("api/auth")
export class IdentityController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountEmailService) private readonly email: AccountEmailService,
    @Inject(GoogleAuthService) private readonly google: GoogleAuthService,
  ) {}
  @Get("options") options() {
    return {
      google: Boolean(this.auth.config.GOOGLE_CLIENT_ID && this.auth.config.MFA_ENCRYPTION_KEY),
      email: this.auth.config.MAIL_MODE !== "disabled",
      localMail: this.auth.config.MAIL_MODE === "file",
    };
  }
  @Post("email/verify") verify(@Req() request: AuthRequest) {
    return this.email.verify(request);
  }
  @Post("email/change") change(@Body() body: unknown, @Req() request: AuthRequest) {
    const value = parse(emailChangeSchema, body);
    return this.email.change(request, value.email, value.password);
  }
  @Post("email/confirm") confirm(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.email.confirm(request, reply, parse(emailConfirmSchema, body).token);
  }
  @Post("password/request-reset") requestReset(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.email.requestReset(request, parse(emailRequestSchema, body).email);
  }
  @Post("password/reset") reset(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    const value = parse(resetPasswordSchema, body);
    return this.email.confirm(request, reply, value.token, value.password);
  }
  @Post("google/start") start(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    const value = parse(googleStartSchema, body);
    return this.google.start(request, reply, value.intent, value.password);
  }
  @Get("google/callback") callback(
    @Query("state") state: string,
    @Query("code") code: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.google.callback(request, reply, state, code);
  }
}
