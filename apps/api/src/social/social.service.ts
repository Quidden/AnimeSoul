import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canSee,
  readVisibility,
  type SocialAction,
  type socialListQuerySchema,
  type peopleQuerySchema,
} from "@animesoul/contracts";
import type { DatabaseTransaction, Prisma } from "@animesoul/database";
import type { z } from "zod";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { digest } from "../auth/security.js";
import { readProfile } from "../account/profile-reader.js";
import {
  blocked,
  friends,
  person,
  personSelect,
  profileFriends,
  socialPair,
  visiblePeople,
} from "./access.js";

@Injectable()
export class SocialService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async relationship(request: AuthRequest, targetId: string) {
    const { userId } = await this.auth.requireSession(request);
    return this.auth.db.$transaction((tx) => this.relation(tx, userId, targetId), {
      isolationLevel: "RepeatableRead",
    });
  }
  private async relation(tx: DatabaseTransaction, userId: string, targetId: string) {
    const target = await tx.userProfile.findFirst({
      where: { userId: targetId, user: { disabledAt: null } },
    });
    if (!target) throw new NotFoundException();
    const own = userId === targetId;
    const pair = socialPair(userId, targetId);
    const [outBlock, inBlock, friendship, pending, follow, followed] = own
      ? [null, null, null, null, null, null]
      : ([
          await tx.userBlock.findUnique({
            where: { blockerId_targetId: { blockerId: userId, targetId } },
          }),
          await tx.userBlock.findUnique({
            where: { blockerId_targetId: { blockerId: targetId, targetId: userId } },
          }),
          await tx.friendship.findUnique({ where: { lowId_highId: pair } }),
          await tx.friendRequest.findUnique({ where: { lowId_highId: pair } }),
          await tx.follow.findUnique({
            where: { followerId_targetId: { followerId: userId, targetId } },
          }),
          await tx.follow.findUnique({
            where: { followerId_targetId: { followerId: targetId, targetId: userId } },
          }),
        ] as const);
    if (inBlock && !outBlock) throw new NotFoundException();
    if (!own && !outBlock && !friendship && !pending && !target.isPublic)
      throw new NotFoundException();
    return {
      person: person(target),
      state: own
        ? "self"
        : outBlock
          ? "blocked"
          : friendship
            ? "friends"
            : pending
              ? pending.requestedBy === userId
                ? "outgoing"
                : "incoming"
              : "none",
      following: !outBlock && Boolean(follow),
      followsYou: !outBlock && Boolean(followed),
      canRequest: !own && !outBlock && !inBlock && target.friendRequests === "everyone",
      canFollow: !own && !outBlock && !inBlock && target.isPublic,
    };
  }
  private async throttle(userId: string) {
    const key = digest("social:" + userId),
      now = new Date(),
      cutoff = new Date(now.getTime() - 60000);
    const rows = await this.auth.db.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "AuthThrottle" ("key", "attempts", "windowStartedAt") VALUES (${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "AuthThrottle"."windowStartedAt" < ${cutoff} THEN 1 ELSE "AuthThrottle"."attempts" + 1 END,
      "windowStartedAt" = CASE WHEN "AuthThrottle"."windowStartedAt" < ${cutoff} THEN ${now} ELSE "AuthThrottle"."windowStartedAt" END
      RETURNING "attempts"`;
    if (rows[0]!.attempts > 60) throw new HttpException("Too many social actions.", 429);
  }
  async change(request: AuthRequest, input: SocialAction) {
    const { userId } = await this.auth.writeSession(request);
    if (userId === input.targetId) throw new BadRequestException("Choose another user.");
    await this.throttle(userId);
    const targetId = input.targetId,
      pair = socialPair(userId, targetId),
      where = { lowId_highId: pair };
    return this.auth.db.$transaction(async (tx) => {
      // All pair mutations lock the two user rows in UUID order. Block/request/follow races serialize.
      const active = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id"::text FROM "User" WHERE "id" IN (${pair.lowId}::uuid, ${pair.highId}::uuid) AND "disabledAt" IS NULL ORDER BY "id" FOR UPDATE`;
      if (active.length !== 2) throw new NotFoundException();
      const target = await tx.userProfile.findUnique({ where: { userId: targetId } });
      if (!target) throw new NotFoundException();
      if (input.action === "block") {
        await tx.userBlock.upsert({
          where: { blockerId_targetId: { blockerId: userId, targetId } },
          create: { blockerId: userId, targetId },
          update: {},
        });
        await tx.friendRequest.deleteMany({ where: pair });
        await tx.friendship.deleteMany({ where: pair });
        await tx.follow.deleteMany({
          where: {
            OR: [
              { followerId: userId, targetId },
              { followerId: targetId, targetId: userId },
            ],
          },
        });
      } else if (input.action === "unblock") {
        await tx.userBlock.deleteMany({ where: { blockerId: userId, targetId } });
      } else {
        if (await blocked(tx, userId, targetId)) throw new NotFoundException();
        const pending = await tx.friendRequest.findUnique({ where });
        const friend = await tx.friendship.findUnique({ where });
        switch (input.action) {
          case "request":
            if (friend) break;
            if (!pending && (!target.isPublic || target.friendRequests !== "everyone"))
              throw new ForbiddenException("Friend requests are unavailable.");
            if (pending && pending.requestedBy !== userId) {
              await tx.friendRequest.delete({ where });
              await tx.friendship.create({ data: pair });
            } else if (!pending)
              await tx.friendRequest.create({ data: { ...pair, requestedBy: userId } });
            break;
          case "accept":
            if (friend) break;
            if (!pending || pending.requestedBy === userId)
              throw new ConflictException("No incoming request.");
            await tx.friendRequest.delete({ where });
            await tx.friendship.create({ data: pair });
            break;
          case "decline":
          case "cancel":
            if (pending && (input.action === "cancel") !== (pending.requestedBy === userId))
              throw new ForbiddenException();
            await tx.friendRequest.deleteMany({ where: pair });
            break;
          case "unfriend":
            await tx.friendship.deleteMany({ where: pair });
            break;
          case "follow":
            if (!target.isPublic)
              throw new ForbiddenException("Only public profiles can be followed.");
            await tx.follow.upsert({
              where: { followerId_targetId: { followerId: userId, targetId } },
              create: { followerId: userId, targetId },
              update: {},
            });
            break;
          case "unfollow":
            await tx.follow.deleteMany({ where: { followerId: userId, targetId } });
            break;
        }
      }
      await tx.auditEvent.create({
        data: { actorId: userId, action: "social." + input.action, objectId: targetId },
      });
      return { ok: true };
    });
  }
  async search(request: AuthRequest, input: z.infer<typeof peopleQuerySchema>) {
    const { userId } = await this.auth.requireSession(request);
    const rows = await this.auth.db.userProfile.findMany({
      where: {
        AND: [
          visiblePeople(userId),
          {
            userId: { not: userId },
            isPublic: true,
            usernameKey: { contains: input.q.toLowerCase().replace(/[\\%_]/g, (v) => "\\" + v) },
          },
        ],
      },
      select: personSelect,
      orderBy: [{ usernameKey: "asc" }, { userId: "asc" }],
      take: 20,
    });
    return { items: rows.map(person) };
  }
  async list(request: AuthRequest, input: z.infer<typeof socialListQuerySchema>) {
    const { userId } = await this.auth.requireSession(request);
    return this.auth.db.$transaction(
      async (tx) => {
        if (input.section === "friends") return profileFriends(tx, userId, userId, input.after);
        let relation: Prisma.UserWhereInput;
        switch (input.section) {
          case "incoming":
            relation = {
              OR: [
                { friendRequestsLow: { some: { highId: userId, requestedBy: { not: userId } } } },
                { friendRequestsHigh: { some: { lowId: userId, requestedBy: { not: userId } } } },
              ],
            };
            break;
          case "outgoing":
            relation = {
              OR: [
                { friendRequestsLow: { some: { highId: userId, requestedBy: userId } } },
                { friendRequestsHigh: { some: { lowId: userId, requestedBy: userId } } },
              ],
            };
            break;
          case "following":
            relation = { followers: { some: { followerId: userId } } };
            break;
          case "followers":
            relation = { following: { some: { targetId: userId } } };
            break;
          case "blocked":
            relation = { blockedBy: { some: { blockerId: userId } } };
            break;
        }
        const showPrivate = ["incoming", "outgoing", "blocked"].includes(input.section);
        const rows = await tx.userProfile.findMany({
          where: {
            AND: [
              { user: { disabledAt: null, ...relation } },
              ...(showPrivate ? [] : [visiblePeople(userId)]),
              ...(input.section !== "blocked"
                ? [
                    {
                      user: {
                        blocks: { none: { targetId: userId } },
                        blockedBy: { none: { blockerId: userId } },
                      },
                    },
                  ]
                : []),
              ...(input.after ? [{ userId: { gt: input.after } }] : []),
            ],
          },
          select: personSelect,
          orderBy: { userId: "asc" },
          take: 51,
        });
        return {
          items: rows.slice(0, 50).map(person),
          next: rows.length > 50 ? rows[49]!.userId : null,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async profile(request: AuthRequest, username: string, after?: string, listOnly = false) {
    const { userId } = await this.auth.requireSession(request);
    return this.auth.db.$transaction(
      async (tx) => {
        const record = await tx.userProfile.findFirst({
          where: { usernameKey: username.toLowerCase(), user: { disabledAt: null } },
        });
        if (!record) throw new NotFoundException();
        const owner = record.userId === userId;
        if (!owner && (await blocked(tx, userId, record.userId))) throw new NotFoundException();
        const friend = !owner && (await friends(tx, userId, record.userId));
        if (!owner && !record.isPublic && !(record.profileAccess === "friends" && friend))
          throw new NotFoundException();
        const visibility = readVisibility(record.visibility),
          friendListAllowed = canSee(visibility.friends, owner, friend);
        if (listOnly) {
          if (!friendListAllowed) throw new NotFoundException();
          return profileFriends(tx, record.userId, userId, after);
        }
        const fields = {
          about: canSee(visibility.about, owner, friend),
          favorites: canSee(visibility.favorites, owner, friend),
          folders: canSee(visibility.folders, owner, friend),
          ratings: canSee(visibility.ratings, owner, friend),
          statistics: canSee(visibility.statistics, owner, friend),
        };
        const result = await readProfile(tx, record, fields);
        const friendList = friendListAllowed
          ? await profileFriends(tx, record.userId, userId)
          : null;
        return {
          ...result,
          contentSections: (["posts", "reviews", "comments"] as const).filter((section) =>
            canSee(visibility[section], owner, friend),
          ),
          ...(friendList ? { friends: friendList.items, friendsNext: friendList.next } : {}),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
