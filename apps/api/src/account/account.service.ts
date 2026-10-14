import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  folderEditSchema,
  folderEntrySchema,
  libraryEditSchema,
  profileEditSchema,
  progressEditSchema,
  ratingEditSchema,
  readVisibility,
  readPlayerPreferences,
  dubbingKey,
  playerPreferencesEditSchema,
  favoriteDubbingSchema,
  animeDubbingSchema,
} from "@animesoul/contracts";
import type { z } from "zod";
import { AuthService, uniqueConflict, type AuthRequest } from "../auth/auth.service.js";
import type { Prisma } from "@animesoul/database";
import { ProfileMediaService } from "./profile-media.service.js";
function jsonObject(value: unknown): Prisma.InputJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}
@Injectable()
export class AccountService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProfileMediaService) private readonly media: ProfileMediaService,
  ) {}
  async playerState(request: AuthRequest, animeId?: string) {
    const { userId } = await this.auth.requireSession(request);
    const profile = await this.auth.db.userProfile.findUniqueOrThrow({ where: { userId } });
    const item = animeId
      ? await this.auth.db.libraryItem.findUnique({
          where: { userId_animeId: { userId, animeId } },
        })
      : null;
    const preferences = jsonObject(profile.preferences);
    const tracking = jsonObject(item?.tracking);
    return {
      preferences: readPlayerPreferences(preferences.player),
      dubbing: typeof tracking.playerDubbing === "string" ? tracking.playerDubbing : null,
    };
  }
  async editPlayer(
    request: AuthRequest,
    input: z.infer<typeof playerPreferencesEditSchema> | z.infer<typeof favoriteDubbingSchema>,
  ) {
    const { userId } = await this.auth.writeSession(request);
    return this.auth.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
      const existing = jsonObject(profile.preferences);
      const player = readPlayerPreferences(existing.player);
      if ("dubbing" in input) {
        player.favoriteDubbings = player.favoriteDubbings.filter(
          (name) => dubbingKey(name) !== dubbingKey(input.dubbing),
        );
        if (input.favorite) player.favoriteDubbings.push(input.dubbing);
        if (player.favoriteDubbings.length > 50)
          throw new BadRequestException("Maximum 50 favorite dubbings.");
      } else Object.assign(player, input);
      await tx.userProfile.update({
        where: { userId },
        data: { preferences: { ...existing, player } },
      });
      return { preferences: player };
    });
  }
  async animeDubbing(request: AuthRequest, input: z.infer<typeof animeDubbingSchema>) {
    const { userId } = await this.auth.writeSession(request);
    await this.ensureAnime(input.animeId, userId);
    return this.auth.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const item = await tx.libraryItem.findUnique({
        where: { userId_animeId: { userId, animeId: input.animeId } },
      });
      const tracking = { ...jsonObject(item?.tracking), playerDubbing: input.dubbing };
      await tx.libraryItem.upsert({
        where: { userId_animeId: { userId, animeId: input.animeId } },
        create: { userId, animeId: input.animeId, tracking },
        update: { tracking },
      });
      return { dubbing: input.dubbing };
    });
  }
  async profile(request: AuthRequest) {
    const session = await this.auth.requireSession(request);
    const profile = await this.auth.db.userProfile.findUniqueOrThrow({
      where: { userId: session.userId },
      select: {
        username: true,
        about: true,
        presence: true,
        isPublic: true,
        indexable: true,
        visibility: true,
        preferences: true,
        avatar: true,
        banner: true,
        profileAccess: true,
        friendRequests: true,
      },
    });
    return {
      ...profile,
      profileAccess: profile.isPublic
        ? "public"
        : profile.profileAccess === "friends"
          ? "friends"
          : "private",
      visibility: readVisibility(profile.visibility),
    };
  }
  async editProfile(request: AuthRequest, input: z.infer<typeof profileEditSchema>) {
    const session = await this.auth.writeSession(request);
    const { avatar, banner, friendRequests, ...fields } = input;
    const profileAccess = input.profileAccess ?? (input.isPublic ? "public" : "private");
    try {
      const previous = await this.auth.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id"::text FROM "User" WHERE "id" = ${session.userId}::uuid FOR UPDATE`;
        const current = await tx.userProfile.findUniqueOrThrow({
          where: { userId: session.userId },
          select: { avatar: true, banner: true },
        });
        await this.media.assertOwned(avatar, session.userId, "avatar");
        await this.media.assertOwned(banner, session.userId, "banner");
        this.media.assertCurrent(avatar, current.avatar);
        this.media.assertCurrent(banner, current.banner);
        await tx.userProfile.update({
          where: { userId: session.userId },
          data: {
            ...fields,
            ...(friendRequests !== undefined ? { friendRequests } : {}),
            profileAccess,
            isPublic: profileAccess === "public",
            ...(avatar !== undefined ? { avatar } : {}),
            ...(banner !== undefined ? { banner } : {}),
            indexable: profileAccess === "public" && input.indexable,
            usernameKey: input.username.toLowerCase(),
          },
        });
        await tx.auditEvent.create({
          data: { actorId: session.userId, action: "profile.updated", objectId: session.userId },
        });
        return current;
      });
      if (avatar !== undefined && avatar !== previous.avatar)
        await this.media.removeOwned(previous.avatar, session.userId, "avatar");
      if (banner !== undefined && banner !== previous.banner)
        await this.media.removeOwned(previous.banner, session.userId, "banner");
      return { ok: true };
    } catch (error) {
      uniqueConflict(error);
    }
  }
  async library(request: AuthRequest) {
    const session = await this.auth.requireSession(request);
    const userId = session.userId;
    const [items, folders, progress] = await Promise.all([
      this.auth.db.libraryItem.findMany({
        where: { userId },
        include: {
          ratings: { select: { scope: true, key: true, score: true } },
          anime: { select: { id: true, slug: true, title: true, poster: true, published: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 2000,
      }),
      this.auth.db.libraryFolder.findMany({
        where: { userId },
        include: { entries: { select: { animeId: true, note: true } } },
        orderBy: { name: "asc" },
        take: 100,
      }),
      this.auth.db.episodeProgress.findMany({
        where: { userId },
        select: {
          animeId: true,
          episodeKey: true,
          position: true,
          duration: true,
          completed: true,
          watchedSeconds: true,
          episode: { select: { id: true, season: true, number: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 10000,
      }),
    ]);
    return {
      items,
      folders: folders.map(({ id, name, entries }) => ({ id, name, entries })),
      progress,
    };
  }
  async ensureAnime(animeId: string, userId: string) {
    const anime = await this.auth.db.anime.findFirst({
      where: { id: animeId, OR: [{ published: true }, { library: { some: { userId } } }] },
      select: { id: true },
    });
    if (!anime) throw new NotFoundException("Anime not found.");
  }
  async editLibrary(request: AuthRequest, input: z.infer<typeof libraryEditSchema>) {
    const session = await this.auth.writeSession(request);
    await this.ensureAnime(input.animeId, session.userId);
    const { animeId } = input;
    const fields = {
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
      ...(input.score !== undefined ? { score: input.score } : {}),
    };
    return this.auth.db.libraryItem.upsert({
      where: { userId_animeId: { userId: session.userId, animeId } },
      create: { userId: session.userId, animeId, ...fields },
      update: fields,
    });
  }
  async rating(request: AuthRequest, input: z.infer<typeof ratingEditSchema>) {
    const session = await this.auth.writeSession(request);
    await this.ensureAnime(input.animeId, session.userId);
    const userId = session.userId;
    return this.auth.db.$transaction(async (tx) => {
      await tx.libraryItem.upsert({
        where: { userId_animeId: { userId, animeId: input.animeId } },
        create: { userId, animeId: input.animeId },
        update: {},
      });
      const key = { userId, animeId: input.animeId, scope: input.scope, key: input.key };
      if (input.score === null) await tx.libraryRating.deleteMany({ where: key });
      else
        await tx.libraryRating.upsert({
          where: { userId_animeId_scope_key: key },
          create: { ...key, score: input.score },
          update: { score: input.score },
        });
      return { ok: true };
    });
  }
  async folder(request: AuthRequest, input: z.infer<typeof folderEditSchema>) {
    const session = await this.auth.writeSession(request);
    if (input.id) {
      const result = await this.auth.db.libraryFolder.updateMany({
        where: { id: input.id, userId: session.userId },
        data: { name: input.name },
      });
      if (result.count !== 1) throw new NotFoundException();
      return { id: input.id, name: input.name };
    }
    if ((await this.auth.db.libraryFolder.count({ where: { userId: session.userId } })) >= 100)
      throw new BadRequestException("Folder limit reached.");
    return this.auth.db.libraryFolder.create({
      data: { userId: session.userId, name: input.name },
      select: { id: true, name: true },
    });
  }
  async deleteFolder(request: AuthRequest, id: string) {
    const session = await this.auth.writeSession(request);
    const result = await this.auth.db.libraryFolder.deleteMany({
      where: { id, userId: session.userId },
    });
    if (result.count !== 1) throw new NotFoundException();
    return { ok: true };
  }
  async folderEntry(request: AuthRequest, input: z.infer<typeof folderEntrySchema>) {
    const session = await this.auth.writeSession(request);
    const userId = session.userId;
    await this.ensureAnime(input.animeId, userId);
    return this.auth.db.$transaction(async (tx) => {
      if (!(await tx.libraryFolder.findFirst({ where: { id: input.folderId, userId } })))
        throw new NotFoundException();
      if (input.remove)
        await tx.folderEntry.deleteMany({
          where: { folderId: input.folderId, animeId: input.animeId, userId },
        });
      else {
        await tx.libraryItem.upsert({
          where: { userId_animeId: { userId, animeId: input.animeId } },
          create: { userId, animeId: input.animeId },
          update: {},
        });
        await tx.folderEntry.upsert({
          where: { folderId_animeId: { folderId: input.folderId, animeId: input.animeId } },
          create: { folderId: input.folderId, animeId: input.animeId, userId, note: input.note },
          update: { note: input.note },
        });
      }
      return { ok: true };
    });
  }
  async progress(request: AuthRequest, input: z.infer<typeof progressEditSchema>) {
    const session = await this.auth.writeSession(request);
    await this.ensureAnime(input.animeId, session.userId);
    if (input.duration > 0 && input.position > input.duration)
      throw new BadRequestException("Position exceeds duration.");
    const userId = session.userId;
    return this.auth.db.$transaction(async (tx) => {
      await tx.libraryItem.upsert({
        where: { userId_animeId: { userId, animeId: input.animeId } },
        create: {
          userId,
          animeId: input.animeId,
          lastEpisode: input.episodeKey,
          dubbing: input.dubbing,
          season: input.season,
        },
        update: { lastEpisode: input.episodeKey, dubbing: input.dubbing, season: input.season },
      });
      return tx.episodeProgress.upsert({
        where: {
          userId_animeId_episodeKey: {
            userId,
            animeId: input.animeId,
            episodeKey: input.episodeKey,
          },
        },
        create: {
          userId,
          animeId: input.animeId,
          episodeKey: input.episodeKey,
          position: input.position,
          duration: input.duration,
          completed: input.completed,
        },
        update: { position: input.position, duration: input.duration, completed: input.completed },
      });
    });
  }
}
