import { Controller, Get, Inject, Req } from "@nestjs/common";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
@Controller("api/admin")
export class AdminController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get()
  async root(@Req() request: AuthRequest) {
    const session = await this.auth.requireSession(request, "admin");
    return {
      authenticated: true,
      userId: session.userId,
      roles: session.user.roles.map((r) => r.role),
      mfaVerified: true,
    };
  }
}
