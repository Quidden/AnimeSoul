import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  adminLoginSchema,
  developerAccessEditSchema,
  claimSchema,
  credentialsSchema,
  passwordSchema,
  registrationSchema,
} from "@animesoul/contracts";
import { z } from "zod";
import { AuthService, type AuthRequest, type AuthReply } from "./auth.service.js";
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Invalid input.");
  return result.data;
}
@Controller("api/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("me") me(@Req() request: AuthRequest) {
    return this.auth.me(request);
  }
  @Get("developer-access")
  @Header("Cache-Control", "private, no-store")
  developerAccess(@Req() request: AuthRequest) {
    return this.auth.developerAccess(request);
  }
  @Post("developer-access")
  @Header("Cache-Control", "private, no-store")
  changeDeveloperAccess(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.auth.changeDeveloperAccess(request, parse(developerAccessEditSchema, body).mode);
  }
  @Post("register") register(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.register(parse(registrationSchema, body), request, reply);
  }
  @Post("claim") claim(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.claim(parse(claimSchema, body), request, reply);
  }
  @Post("login") login(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.login(parse(credentialsSchema, body), request, reply);
  }
  @Post("logout") logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.logout(request, reply);
  }
  @Post("logout-all") logoutAll(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.logout(request, reply, true);
  }
  @Post("password") password(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    const value = parse(z.object({ current: passwordSchema, next: passwordSchema }), body);
    return this.auth.password(request, reply, value.current, value.next);
  }
  @Post("mfa/begin") beginMfa(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.auth.beginMfa(
      request,
      parse(z.object({ password: passwordSchema }), body).password,
    );
  }
  @Post("mfa/confirm") confirmMfa(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.auth.confirmMfa(
      request,
      parse(z.object({ code: z.string().regex(/^\d{6}$/) }), body).code,
    );
  }
}
@Controller("api/admin/auth")
export class AdminAuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post("login") login(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.login(parse(adminLoginSchema, body), request, reply, "admin");
  }
  @Get("me") me(@Req() request: AuthRequest) {
    return this.auth.me(request, "admin");
  }
  @Post("logout") logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: AuthReply,
  ) {
    return this.auth.logout(request, reply, false, "admin");
  }
}
