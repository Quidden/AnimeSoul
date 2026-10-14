import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { type z } from "zod";
import { playbackProgressSchema } from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
@Injectable()
export class ProgressService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async saved(request: AuthRequest, animeId: string) {
    const session = await this.auth.requireSession(request);
    const rows = await this.auth.db.episodeProgress.findMany({
      where: { userId: session.userId, animeId, episodeId: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 20000,
    });
    return {
      progress: rows.map((row) => ({
        episodeId: row.episodeId,
        position: row.position,
        duration: row.duration,
        completed: row.completed,
        updatedAt: row.updatedAt.toISOString(),
        dubbing:
          typeof row.details === "object" &&
          row.details !== null &&
          !Array.isArray(row.details) &&
          typeof row.details.dubbing === "string"
            ? row.details.dubbing
            : "",
      })),
    };
  }
  async start(request: AuthRequest, episodeId: string) {
    const auth = await this.auth.writeSession(request);
    await this.auth.db.playbackSession.deleteMany({
      where: { userId: auth.userId, expiresAt: { lt: new Date() } },
    });
    return this.auth.db.$transaction(async (tx) => {
      const episode = await tx.episode.findFirst({
        where: {
          id: episodeId,
          anime: {
            published: true,
            ...(this.auth.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
          },
        },
      });
      if (!episode) throw new NotFoundException();
      const session = await tx.playbackSession.create({
        data: {
          userId: auth.userId,
          authSessionId: auth.id,
          episodeId,
          animeId: episode.animeId,
          expiresAt: new Date(Date.now() + 12 * 3600000),
        },
      });
      await tx.libraryItem.upsert({
        where: { userId_animeId: { userId: auth.userId, animeId: episode.animeId } },
        create: { userId: auth.userId, animeId: episode.animeId },
        update: {},
      });
      const key = {
        userId: auth.userId,
        animeId: episode.animeId,
        episodeKey: "episode:" + episodeId,
      };
      await tx.episodeProgress.upsert({
        where: { userId_animeId_episodeKey: key },
        create: { ...key, episodeId, activePlaybackId: session.id },
        update: { activePlaybackId: session.id },
      });
      return { sessionId: session.id };
    });
  }
  async save(request: AuthRequest, input: z.infer<typeof playbackProgressSchema>) {
    const auth = await this.auth.writeSession(request);
    if (input.duration > 0 && input.position > input.duration)
      throw new BadRequestException("Position exceeds duration.");
    if (input.completed && (input.duration <= 0 || input.position < input.duration * 0.9))
      throw new BadRequestException("Episode is not complete.");
    return this.auth.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PlaybackSession" WHERE "id"::text = ${input.sessionId} FOR UPDATE`;
      const session = await tx.playbackSession.findFirst({
        where: {
          id: input.sessionId,
          userId: auth.userId,
          authSessionId: auth.id,
          expiresAt: { gt: new Date() },
        },
        include: { episode: true },
      });
      if (!session) throw new NotFoundException();
      if (session.sequence >= input.sequence) return { ignored: true };
      const now = new Date();
      const watched = Math.min(
        input.watchedDelta,
        Math.max(0, (now.getTime() - session.lastEventAt.getTime()) / 1000),
        30,
      );
      await tx.playbackSession.update({
        where: { id: session.id },
        data: { sequence: input.sequence, lastEventAt: now },
      });
      const key = {
        userId: auth.userId,
        animeId: session.animeId,
        episodeKey: "episode:" + session.episodeId,
        activePlaybackId: session.id,
      };
      const result = await tx.episodeProgress.updateMany({
        where: key,
        data: {
          position: input.position,
          duration: input.duration,
          completed: input.completed,
          watchedSeconds: { increment: watched },
        },
      });
      if (result.count !== 1) return { ignored: true };
      await tx.$executeRaw`UPDATE "EpisodeProgress" SET "details" = jsonb_set("details", '{dubbing}', ${JSON.stringify(input.dubbing)}::jsonb, true) WHERE "userId" = ${auth.userId}::uuid AND "animeId" = ${session.animeId}::uuid AND "episodeKey" = ${key.episodeKey} AND "activePlaybackId" = ${session.id}::uuid`;
      const season = Number(session.episode.season);
      await tx.libraryItem.update({
        where: { userId_animeId: { userId: auth.userId, animeId: session.animeId } },
        data: {
          lastEpisode: "episode:" + session.episodeId,
          dubbing: input.dubbing,
          ...(Number.isInteger(season) && season >= 1 && season <= 1000 ? { season } : {}),
        },
      });
      return { ignored: false };
    });
  }
}
