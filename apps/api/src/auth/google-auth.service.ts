import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { privateVisibility } from "@animesoul/contracts";
import {
  AuthService,
  cookieToken,
  uniqueConflict,
  type AuthReply,
  type AuthRequest,
} from "./auth.service.js";
import { digest, decryptSecret, encryptSecret, randomToken, verifyPassword } from "./security.js";
import { GOOGLE_CLIENT, GoogleClient } from "./google-client.js";
import { registrationTrial } from "./trial.js";
const browserCookie = "animesoul_oauth";
@Injectable()
export class GoogleAuthService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GOOGLE_CLIENT) private readonly google: GoogleClient,
  ) {}
  private cookie(value: string, clear = false) {
    return `${browserCookie}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${this.auth.config.NODE_ENV === "production" ? "; Secure" : ""}`;
  }
  async start(request: AuthRequest, reply: AuthReply, intent: "login" | "link", password?: string) {
    if (
      !this.auth.config.GOOGLE_CLIENT_ID ||
      !this.auth.config.GOOGLE_CLIENT_SECRET ||
      !this.auth.config.MFA_ENCRYPTION_KEY
    )
      throw new ServiceUnavailableException("Google is not configured.");
    this.auth.origin(request);
    await this.auth.throttle(request, "google:" + intent + ":" + request.ip);
    let userId: string | null = null,
      sessionHash: string | null = null;
    if (intent === "link") {
      const session = await this.auth.writeSession(request);
      if (session.user.googleSubject) throw new ConflictException("Google is already linked.");
      if (!(await verifyPassword(password ?? "", session.user.passwordHash)))
        throw new UnauthorizedException();
      userId = session.userId;
      sessionHash = session.tokenHash;
    }
    const state = randomToken(),
      browser = randomToken(),
      nonce = randomToken(),
      verifier = randomToken(),
      stateHash = digest(state);
    await this.auth.db.oAuthAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.auth.db.oAuthAttempt.create({
      data: {
        stateHash,
        browserHash: digest(browser),
        nonce,
        verifierEncrypted: encryptSecret(verifier, this.auth.config.MFA_ENCRYPTION_KEY, stateHash),
        userId,
        sessionHash,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    reply.header("Set-Cookie", this.cookie(browser));
    return {
      url: this.google.authorization(
        state,
        nonce,
        createHash("sha256").update(verifier).digest("base64url"),
      ),
    };
  }
  async callback(request: AuthRequest, reply: AuthReply, state: string, code: string) {
    const browser =
      (typeof request.headers.cookie === "string" ? request.headers.cookie : "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(browserCookie + "="))
        ?.slice(browserCookie.length + 1) ?? "";
    if (
      typeof state !== "string" ||
      typeof code !== "string" ||
      !/^[\w-]{43}$/.test(browser) ||
      !/^[\w-]{43}$/.test(state) ||
      !code ||
      code.length > 4096
    )
      throw new BadRequestException("OAuth attempt is invalid.");
    const attempt = await this.auth.db.oAuthAttempt.findUnique({
      where: { stateHash: digest(state) },
    });
    if (
      !attempt ||
      attempt.browserHash !== digest(browser) ||
      attempt.consumedAt ||
      attempt.expiresAt <= new Date()
    )
      throw new BadRequestException("OAuth attempt is invalid.");
    const consumed = await this.auth.db.oAuthAttempt.updateMany({
      where: { stateHash: attempt.stateHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException("OAuth attempt was already used.");
    let identity;
    try {
      identity = await this.google.exchange(
        code,
        decryptSecret(
          attempt.verifierEncrypted,
          this.auth.config.MFA_ENCRYPTION_KEY,
          attempt.stateHash,
        ),
        attempt.nonce,
      );
    } catch {
      throw new UnauthorizedException("Google authentication failed.");
    }
    if (attempt.userId) {
      const session = await this.auth.requireSession(request);
      if (
        session.userId !== attempt.userId ||
        session.tokenHash !== attempt.sessionHash ||
        session.tokenHash !== digest(cookieToken(request, "web"))
      )
        throw new UnauthorizedException();
      try {
        await this.auth.db.$transaction(async (tx) => {
          const linked = await tx.user.updateMany({
            where: {
              id: session.userId,
              disabledAt: null,
              googleSubject: null,
              authVersion: session.user.authVersion,
            },
            data: { googleSubject: identity.subject, authVersion: { increment: 1 } },
          });
          if (linked.count !== 1) throw new ConflictException("Account changed.");
          await tx.session.updateMany({
            where: { userId: session.userId, id: { not: session.id }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.auditEvent.create({
            data: {
              actorId: session.userId,
              objectId: session.userId,
              action: "account.google.linked",
            },
          });
        });
      } catch (error) {
        uniqueConflict(error);
      }
      reply.header("Set-Cookie", this.cookie("", true));
      return { ok: true };
    }
    let user = await this.auth.db.user.findUnique({ where: { googleSubject: identity.subject } });
    if (!user) {
      // Matching email is deliberately insufficient to attach Google to an existing account.
      if (await this.auth.db.user.findUnique({ where: { email: identity.email } }))
        throw new ConflictException(
          "Sign in to your existing account and link Google in settings.",
        );
      try {
        const username = "user-" + randomUUID().slice(0, 18);
        user = await this.auth.db.user.create({
          data: {
            email: identity.email,
            emailVerifiedAt: new Date(),
            googleSubject: identity.subject,
            subscriptionTrial: { create: registrationTrial() },
            profile: {
              create: {
                username,
                usernameKey: username,
                visibility: privateVisibility,
                content: {},
              },
            },
          },
        });
        await this.auth.db.auditEvent.create({
          data: { actorId: user.id, objectId: user.id, action: "account.google.registered" },
        });
      } catch (error) {
        uniqueConflict(error);
      }
    }
    if (user.disabledAt) throw new UnauthorizedException();
    let sessionValue = "";
    const sessionReply: AuthReply = {
      header: (name, value) => {
        if (name === "Set-Cookie" && typeof value === "string") sessionValue = value;
      },
    };
    await this.auth.issueSession(user.id, sessionReply, "web", user.passwordHash, identity.subject);
    reply.header("Set-Cookie", [sessionValue, this.cookie("", true)]);
    return { ok: true };
  }
}
