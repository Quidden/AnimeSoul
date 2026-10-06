import { All, Controller, UnauthorizedException } from "@nestjs/common";
/** The entire admin prefix is also denied by the server until authentication is ready. */
@Controller("api/admin")
export class AdminController {
  @All()
  root(): never {
    throw new UnauthorizedException();
  }
}
