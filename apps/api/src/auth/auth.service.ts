import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createDatabase, type Database } from "@animesoul/database";
import {
  privateVisibility,
  isTrustedRequestOrigin,
  loginFailureMessages,
  developerAccessModeSchema,
  developerAccessSchema,
  developerRole,
  type DeveloperAccessMode,
  type credentialsSchema,
  type registrationSchema,
  type claimSchema,
} from "@animesoul/contracts";
import type { z } from "zod";
import { registrationTrial } from "./trial.js";
import { CONFIG, type Configuration } from "../config.js";
import {
  csrfToken,
  decryptSecret,
  digest,
  encryptSecret,
  hashPassword,
  newTotpSecret,
  randomToken,
  totpCounter,
  verifyPassword,
} from "./security.js";

export type Audience = "web" | "admin";
export type AuthRequest = { headers: Record<string, string | string[] | undefined>; ip: string };
export type AuthReply = { header: (name: string, value: string | string[]) => unknown };
const cookieName = (audience: Audience) => `animesoul_${audience}_session`;
const sessionLifetime = (audience: Audience, remember = false) =>
  audience === "admin" ? (remember ? 30 * 86400 : 3600) : 604800;
export function cookieToken(request: AuthRequest, audience: Audience) {
  const cookie = request.headers.cookie;
  if (typeof cookie !== "string") return "";
  const value =
    cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName(audience) + "="))
      ?.split("=")[1] ?? "";
  return /^[\w-]{43}$/.test(value) ? value : "";
}
export function uniqueConflict(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    throw new ConflictException("Email or username is already in use.");
  throw error;
}
@Injectable()
export class AuthService {
  private readonly database: Database | undefined;
  constructor(@Inject(CONFIG) readonly config: Configuration) {
    this.database = config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : undefined;
  }
  get db(): Database {
    if (!this.database)
      throw new ServiceUnavailableException("Account database is not configured.");
    return this.database;
  }
  origin(request: AuthRequest, audience: Audience = "web") {
    if (
      !isTrustedRequestOrigin(
        request.headers.origin,
        audience === "web" ? this.config.SITE_URL : this.config.ADMIN_URL,
      ) ||
      request.headers["x-animesoul-request"] !== "1"
    )
      throw new ForbiddenException("Invalid request origin.");
  }
  async throttle(request: AuthRequest, identity: string) {
    const now = new Date();
    const keys = [digest("identity:" + identity), digest("ip:" + request.ip)];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      const rows = await this.db.$queryRaw<{ attempts: number }[]>`
        INSERT INTO "AuthThrottle" ("key", "attempts", "windowStartedAt") VALUES (${key}, 1, ${now})
        ON CONFLICT ("key") DO UPDATE SET
          "attempts" = CASE WHEN "AuthThrottle"."windowStartedAt" < ${new Date(now.getTime() - 600000)} THEN 1 ELSE "AuthThrottle"."attempts" + 1 END,
          "windowStartedAt" = CASE WHEN "AuthThrottle"."windowStartedAt" < ${new Date(now.getTime() - 600000)} THEN ${now} ELSE "AuthThrottle"."windowStartedAt" END
        RETURNING "attempts"`;
      if (rows[0]!.attempts > (index === 0 ? 10 : 60))
        throw new HttpException("Too many authentication attempts. Try later.", 429);
    }
    await this.db.authThrottle.deleteMany({
      where: { windowStartedAt: { lt: new Date(now.getTime() - 86400000) } },
    });
  }
  async requireSession(
    request: AuthRequest,
    audience: Audience = "web",
    access: "admin" | "providers" = "admin",
    siteAccess: "effective" | "actual" = "effective",
  ) {
    const token = cookieToken(request, audience);
    if (!token || !this.database) throw new UnauthorizedException();
    const session = await this.db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: { include: { roles: true, permissions: true, profile: true } } },
    });
    if (
      !session ||
      session.audience !== audience ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.disabledAt ||
      !(session.user.passwordHash || session.user.googleSubject)
    )
      throw new UnauthorizedException();
    if (
      audience === "admin" &&
      (!session.mfaVerifiedAt ||
        !(
          session.user.roles.some((r) => ["owner", "admin"].includes(r.role)) ||
          (access === "providers" &&
            session.user.permissions.some((p) => p.permission === "providers.yummy.manage"))
        ))
    )
      throw new ForbiddenException();
    if (
      audience === "web" &&
      siteAccess === "effective" &&
      developerRole(session.user.roles.map((value) => value.role)) &&
      session.developerAccessMode !== "actual"
    ) {
      if (session.developerAccessMode === "guest") throw new UnauthorizedException();
      return { ...session, user: { ...session.user, roles: [], permissions: [] } };
    }
    return session;
  }
  async writeSession(
    request: AuthRequest,
    audience: Audience = "web",
    access: "admin" | "providers" = "admin",
    siteAccess: "effective" | "actual" = "effective",
  ) {
    this.origin(request, audience);
    const session = await this.requireSession(request, audience, access, siteAccess);
    if (request.headers["x-csrf-token"] !== csrfToken(cookieToken(request, audience)))
      throw new ForbiddenException("Invalid CSRF token.");
    return session;
  }
  async developerAccess(request: AuthRequest) {
    const session = await this.requireSession(request, "web", "admin", "actual");
    const role = developerRole(session.user.roles.map((value) => value.role));
    if (!role) throw new ForbiddenException();
    return developerAccessSchema.parse({
      mode: developerAccessModeSchema.parse(session.developerAccessMode),
      role,
      csrfToken: csrfToken(cookieToken(request, "web")),
    });
  }
  async changeDeveloperAccess(request: AuthRequest, mode: DeveloperAccessMode) {
    const actor = await this.writeSession(request, "web", "admin", "actual");
    if (!developerRole(actor.user.roles.map((value) => value.role))) throw new ForbiddenException();
    await this.db.$transaction(async (tx) => {
      const changed = await tx.session.updateMany({
        where: {
          id: actor.id,
          audience: "web",
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { disabledAt: null, roles: { some: { role: { in: ["owner", "admin"] } } } },
        },
        data: { developerAccessMode: mode },
      });
      if (changed.count !== 1) throw new ForbiddenException();
      await tx.auditEvent.create({
        data: {
          actorId: actor.userId,
          action: "account.developer-access.changed",
          objectId: actor.id,
          details: { before: actor.developerAccessMode, after: mode },
        },
      });
    });
    return this.developerAccess(request);
  }
  setCookie(reply: AuthReply, token: string, audience: Audience, clear = false, remember = false) {
    reply.header("Set-Cookie", this.sessionCookie(token, audience, clear, remember));
  }
  sessionCookie(token: string, audience: Audience, clear = false, remember = false) {
    return `${cookieName(audience)}=${token}; Path=/; HttpOnly; SameSite=${audience === "admin" ? "Strict" : "Lax"}; Max-Age=${clear ? 0 : sessionLifetime(audience, remember)}${this.config.NODE_ENV === "production" ? "; Secure" : ""}`;
  }
  async issueSession(
    userId: string,
    reply: AuthReply,
    audience: Audience,
    expectedPasswordHash: string | null,
    expectedGoogleSubject: string | null = null,
    remember = false,
  ) {
    const token = randomToken();
    await this.db.$transaction(async (tx) => {
      const active = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "User" WHERE "id"::text = ${userId} AND "passwordHash" IS NOT DISTINCT FROM ${expectedPasswordHash} AND (${expectedGoogleSubject}::text IS NULL OR "googleSubject" = ${expectedGoogleSubject}) AND "disabledAt" IS NULL FOR UPDATE`;
      if (active.length !== 1)
        throw new UnauthorizedException("Credentials changed. Sign in again.");
      await tx.session.create({
        data: {
          userId,
          tokenHash: digest(token),
          audience,
          expiresAt: new Date(Date.now() + sessionLifetime(audience, remember) * 1000),
          ...(audience === "admin" ? { mfaVerifiedAt: new Date() } : {}),
        },
      });
    });
    this.setCookie(reply, token, audience, false, remember);
    return { authenticated: true, csrfToken: csrfToken(token) };
  }
  async register(
    input: z.infer<typeof registrationSchema>,
    request: AuthRequest,
    reply: AuthReply,
  ) {
    this.origin(request);
    await this.throttle(request, "registration:" + input.email);
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await this.db.user.create({
        data: {
          email: input.email,
          passwordHash,
          subscriptionTrial: { create: registrationTrial() },
          profile: {
            create: {
              username: input.username,
              usernameKey: input.username.toLowerCase(),
              visibility: privateVisibility,
              content: {},
            },
          },
        },
      });
    } catch (error) {
      uniqueConflict(error);
    }
    await this.db.auditEvent.create({
      data: { actorId: user.id, action: "account.registered", objectId: user.id },
    });
    return this.issueSession(user.id, reply, "web", passwordHash);
  }
  async claim(input: z.infer<typeof claimSchema>, request: AuthRequest, reply: AuthReply) {
    this.origin(request);
    await this.throttle(request, "claim:" + input.email);
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    try {
      userId = await this.db.$transaction(async (tx) => {
        const legacy = await tx.legacyProfile.findUnique({
          where: { claimHash: digest(input.code) },
        });
        if (
          !legacy ||
          legacy.claimedAt ||
          !legacy.claimExpiresAt ||
          legacy.claimExpiresAt <= new Date()
        )
          throw new BadRequestException("Claim code is invalid or expired.");
        const claimed = await tx.legacyProfile.updateMany({
          where: { legacyId: legacy.legacyId, claimedAt: null, claimHash: digest(input.code) },
          data: { claimedAt: new Date(), claimHash: null, claimExpiresAt: null },
        });
        const updated = await tx.user.updateMany({
          where: { id: legacy.userId, email: null, passwordHash: null, disabledAt: null },
          data: { email: input.email, passwordHash },
        });
        if (claimed.count !== 1 || updated.count !== 1)
          throw new ConflictException("Profile was already claimed.");
        await tx.auditEvent.create({
          data: { actorId: legacy.userId, action: "account.claimed", objectId: legacy.userId },
        });
        return legacy.userId;
      });
    } catch (error) {
      uniqueConflict(error);
    }
    return this.issueSession(userId, reply, "web", passwordHash);
  }
  async login(
    input: z.infer<typeof credentialsSchema> & { code?: string; remember?: boolean },
    request: AuthRequest,
    reply: AuthReply,
    audience: Audience = "web",
  ) {
    this.origin(request, audience);
    await this.throttle(request, "login:" + input.email);
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: { roles: true, permissions: true, mfa: true },
    });
    const valid = await verifyPassword(input.password, user?.passwordHash ?? null);
    if (audience === "web") {
      const code = !user
        ? "ACCOUNT_NOT_FOUND"
        : !user.passwordHash
          ? user.googleSubject
            ? "GOOGLE_LOGIN_REQUIRED"
            : "PASSWORD_NOT_SET"
          : !valid
            ? "INVALID_PASSWORD"
            : user.disabledAt
              ? "ACCOUNT_DISABLED"
              : null;
      if (code) throw new UnauthorizedException({ code, message: loginFailureMessages[code] });
    }
    if (!valid || !user || user.disabledAt) throw new UnauthorizedException("Invalid credentials.");
    if (audience === "admin") {
      if (
        !user.roles.some((r) => ["owner", "admin"].includes(r.role)) &&
        !user.permissions.some((p) => p.permission === "providers.yummy.manage")
      )
        throw new UnauthorizedException("Invalid credentials.");
      await this.verifyMfa(user.id, input.code ?? "");
    }
    await this.db.auditEvent.create({
      data: { actorId: user.id, action: `session.login.${audience}`, objectId: user.id },
    });
    return this.issueSession(user.id, reply, audience, user.passwordHash!, null, input.remember);
  }
  async me(request: AuthRequest, audience: Audience = "web") {
    const session = await this.requireSession(
      request,
      audience,
      audience === "admin" ? "providers" : "admin",
    );
    const mfa = await this.db.mfaCredential.findUnique({
      where: { userId: session.userId },
      select: { enabledAt: true },
    });
    return {
      id: session.userId,
      email: session.user.email,
      username: session.user.profile?.username ?? "",
      avatar: session.user.profile?.avatar ?? null,
      profilePublic: session.user.profile?.isPublic ?? false,
      emailVerified: !!session.user.emailVerifiedAt,
      hasPassword: !!session.user.passwordHash,
      googleLinked: !!session.user.googleSubject,
      roles: session.user.roles.map((r) => r.role),
      permissions: session.user.permissions
        .filter((p) => p.permission === "providers.yummy.manage")
        .map((p) => p.permission),
      mfaEnabled: !!mfa?.enabledAt,
      csrfToken: csrfToken(cookieToken(request, audience)),
    };
  }
  async logout(request: AuthRequest, reply: AuthReply, all = false, audience: Audience = "web") {
    const session = await this.writeSession(
      request,
      audience,
      audience === "admin" ? "providers" : "admin",
      "actual",
    );
    await this.db.$transaction([
      this.db.session.updateMany({
        where: all ? { userId: session.userId, revokedAt: null } : { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.db.auditEvent.create({
        data: {
          actorId: session.userId,
          action: all ? "session.logout-all" : "session.logout",
          objectId: session.userId,
        },
      }),
    ]);
    this.setCookie(reply, "", audience, true);
    return { ok: true };
  }
  async password(request: AuthRequest, reply: AuthReply, current: string, next: string) {
    const session = await this.writeSession(request);
    await this.throttle(request, "password:" + session.userId);
    if (!(await verifyPassword(current, session.user.passwordHash)))
      throw new UnauthorizedException("Invalid credentials.");
    const passwordHash = await hashPassword(next);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: session.userId },
        data: { passwordHash, authVersion: { increment: 1 } },
      }),
      this.db.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.db.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "account.password-changed",
          objectId: session.userId,
        },
      }),
    ]);
    this.setCookie(reply, "", "web", true);
    return { ok: true };
  }
  async beginMfa(request: AuthRequest, password: string) {
    const session = await this.writeSession(request);
    await this.throttle(request, "mfa:" + session.userId);
    if (!(await verifyPassword(password, session.user.passwordHash)))
      throw new UnauthorizedException("Invalid credentials.");
    const current = await this.db.mfaCredential.findUnique({ where: { userId: session.userId } });
    if (current?.enabledAt) throw new ConflictException("MFA is already enabled.");
    const secret = newTotpSecret();
    const pendingEncrypted = encryptSecret(secret, this.config.MFA_ENCRYPTION_KEY, session.userId);
    const pendingExpiresAt = new Date(Date.now() + 300000);
    await this.db.mfaCredential.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, pendingEncrypted, pendingExpiresAt, recoveryHashes: [] },
      update: { pendingEncrypted, pendingExpiresAt },
    });
    return {
      secret,
      uri: `otpauth://totp/AnimeSoul:${encodeURIComponent(session.user.email ?? session.userId)}?secret=${secret}&issuer=AnimeSoul&algorithm=SHA1&digits=6&period=30`,
    };
  }
  async confirmMfa(request: AuthRequest, code: string) {
    const session = await this.writeSession(request);
    await this.throttle(request, "mfa:" + session.userId);
    const credential = await this.db.mfaCredential.findUnique({
      where: { userId: session.userId },
    });
    if (
      !credential?.pendingEncrypted ||
      !credential.pendingExpiresAt ||
      credential.pendingExpiresAt <= new Date() ||
      credential.enabledAt
    )
      throw new BadRequestException("MFA setup expired.");
    const counter = totpCounter(
      decryptSecret(credential.pendingEncrypted, this.config.MFA_ENCRYPTION_KEY, session.userId),
      code,
    );
    if (counter === null) throw new UnauthorizedException("Invalid verification code.");
    const recoveryCodes = Array.from({ length: 8 }, randomToken);
    await this.db.$transaction(async (tx) => {
      const result = await tx.mfaCredential.updateMany({
        where: {
          userId: session.userId,
          pendingEncrypted: credential.pendingEncrypted,
          enabledAt: null,
        },
        data: {
          secretEncrypted: credential.pendingEncrypted,
          pendingEncrypted: null,
          pendingExpiresAt: null,
          enabledAt: new Date(),
          lastCounter: counter,
          recoveryHashes: recoveryCodes.map(digest),
        },
      });
      if (result.count !== 1) throw new ConflictException("MFA setup changed.");
      await tx.session.updateMany({
        where: { userId: session.userId, id: { not: session.id } },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId: session.userId, action: "account.mfa-enabled", objectId: session.userId },
      });
    });
    return { recoveryCodes };
  }
  async verifyMfa(userId: string, code: string) {
    const credential = await this.db.mfaCredential.findUnique({ where: { userId } });
    if (!credential?.enabledAt || !credential.secretEncrypted)
      throw new UnauthorizedException("MFA is required.");
    const recoveryHash = digest(code);
    if (credential.recoveryHashes.includes(recoveryHash)) {
      const result = await this.db.mfaCredential.updateMany({
        where: { userId, recoveryHashes: { equals: credential.recoveryHashes } },
        data: { recoveryHashes: credential.recoveryHashes.filter((h) => h !== recoveryHash) },
      });
      if (result.count !== 1) throw new UnauthorizedException("Invalid verification code.");
      await this.db.auditEvent.create({
        data: { actorId: userId, action: "account.mfa-recovery-used", objectId: userId },
      });
      return;
    }
    const counter = totpCounter(
      decryptSecret(credential.secretEncrypted, this.config.MFA_ENCRYPTION_KEY, userId),
      code,
    );
    if (counter === null || counter <= credential.lastCounter)
      throw new UnauthorizedException("Invalid verification code.");
    const result = await this.db.mfaCredential.updateMany({
      where: {
        userId,
        lastCounter: credential.lastCounter,
        secretEncrypted: credential.secretEncrypted,
      },
      data: { lastCounter: counter },
    });
    if (result.count !== 1) throw new UnauthorizedException("Invalid verification code.");
  }
  async onModuleDestroy() {
    await this.database?.$disconnect();
  }
}
