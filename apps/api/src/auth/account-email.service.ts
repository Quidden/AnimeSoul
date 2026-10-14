import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService, uniqueConflict, type AuthReply, type AuthRequest } from "./auth.service.js";
import { ACCOUNT_MAIL, type MailDelivery } from "./account-mailer.js";
import { digest, hashPassword, randomToken, verifyPassword } from "./security.js";
type Purpose = "verify" | "reset" | "change";
@Injectable()
export class AccountEmailService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ACCOUNT_MAIL) private readonly deliver: MailDelivery,
  ) {}
  available() {
    if (this.auth.config.MAIL_MODE === "disabled")
      throw new ServiceUnavailableException("Email is not configured.");
  }
  private async issue(
    user: { id: string; email: string | null; authVersion: number },
    purpose: Purpose,
    targetEmail: string,
  ) {
    const token = randomToken();
    const data = {
      tokenHash: digest(token),
      targetEmail,
      issuedVersion: user.authVersion,
      expiresAt: new Date(Date.now() + (purpose === "verify" ? 86400000 : 1800000)),
      consumedAt: null,
    };
    await this.auth.db.accountToken.upsert({
      where: { userId_purpose: { userId: user.id, purpose } },
      create: { userId: user.id, purpose, ...data },
      update: data,
    });
    const link = new URL("/account", this.auth.config.SITE_URL);
    link.hash = new URLSearchParams({ action: purpose, token }).toString();
    const title =
      purpose === "reset"
        ? "Восстановление пароля"
        : purpose === "change"
          ? "Подтверждение новой почты"
          : "Подтверждение почты";
    try {
      await this.deliver({
        to: targetEmail,
        subject: "AnimeSoul — " + title,
        text:
          title +
          "\n\n" +
          link.href +
          "\n\nЕсли вы не запрашивали это действие, проигнорируйте письмо.",
      });
    } catch {
      await this.auth.db.accountToken.deleteMany({ where: { tokenHash: data.tokenHash } });
      throw new ServiceUnavailableException("Email could not be delivered.");
    }
    return { accepted: true };
  }
  async verify(request: AuthRequest) {
    this.available();
    const session = await this.auth.writeSession(request);
    await this.auth.throttle(request, "email:" + session.userId);
    if (!session.user.email) throw new ConflictException();
    if (session.user.emailVerifiedAt) return { accepted: true };
    return this.issue(session.user, "verify", session.user.email);
  }
  async change(request: AuthRequest, email: string, password: string) {
    this.available();
    const session = await this.auth.writeSession(request);
    await this.auth.throttle(request, "email:" + session.userId);
    if (!(await verifyPassword(password, session.user.passwordHash)))
      throw new UnauthorizedException("Invalid credentials.");
    if (email === session.user.email) throw new BadRequestException();
    if (await this.auth.db.user.findUnique({ where: { email } }))
      throw new ConflictException("Email is already in use.");
    return this.issue(session.user, "change", email);
  }
  async requestReset(request: AuthRequest, email: string) {
    this.available();
    this.auth.origin(request);
    await this.auth.throttle(request, "reset:" + email);
    const user = await this.auth.db.user.findUnique({ where: { email } });
    // A submitted registration email is not proof of ownership.
    if (user?.emailVerifiedAt && !user.disabledAt) {
      try {
        await this.issue(user, "reset", email);
      } catch {
        /* Preserve the same public response for every account. */
      }
    }
    return { accepted: true };
  }
  async confirm(request: AuthRequest, reply: AuthReply, token: string, password?: string) {
    this.auth.origin(request);
    await this.auth.throttle(request, "email-token:" + digest(token));
    const passwordHash = password ? await hashPassword(password) : undefined;
    let revokes = false;
    try {
      await this.auth.db.$transaction(async (tx) => {
        const row = await tx.accountToken.findUnique({ where: { tokenHash: digest(token) } });
        if (
          !row ||
          row.consumedAt ||
          row.expiresAt <= new Date() ||
          (row.purpose === "reset") !== Boolean(passwordHash)
        )
          throw new BadRequestException("Link is invalid or expired.");
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"::text = ${row.userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
        if (
          user.disabledAt ||
          user.authVersion !== row.issuedVersion ||
          (row.purpose !== "change" && user.email !== row.targetEmail)
        )
          throw new BadRequestException("Link is invalid or expired.");
        const used = await tx.accountToken.updateMany({
          where: { id: row.id, tokenHash: digest(token), consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (used.count !== 1) throw new BadRequestException("Link was already used.");
        revokes = row.purpose !== "verify";
        await tx.user.update({
          where: { id: user.id },
          data: {
            ...(row.purpose === "reset"
              ? { passwordHash: passwordHash! }
              : { emailVerifiedAt: new Date() }),
            ...(row.purpose === "change" ? { email: row.targetEmail } : {}),
            ...(revokes ? { authVersion: { increment: 1 } } : {}),
          },
        });
        if (revokes)
          await tx.session.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        await tx.auditEvent.create({
          data: { actorId: user.id, objectId: user.id, action: "account.email." + row.purpose },
        });
      });
    } catch (error) {
      uniqueConflict(error);
    }
    if (revokes) this.auth.setCookie(reply, "", "web", true);
    return { ok: true, signInRequired: revokes };
  }
}
