import { publicProfile, type ProfileRecord, type visibilitySchema } from "@animesoul/contracts";
import type { DatabaseTransaction, Prisma } from "@animesoul/database";
import type { z } from "zod";

export async function readProfile(
  tx: DatabaseTransaction,
  record: Prisma.UserProfileGetPayload<object>,
  visibility: z.infer<typeof visibilitySchema>,
) {
  const userId = record.userId;
  // An interactive transaction owns one PostgreSQL connection; queries run sequentially.
  const favorites = visibility.favorites
    ? await tx.libraryItem.findMany({
        where: { userId, favorite: true, anime: { published: true } },
        select: { animeId: true },
        take: 2000,
      })
    : [];
  const folders = visibility.folders
    ? await tx.libraryFolder.findMany({
        where: { userId },
        select: {
          name: true,
          entries: { where: { anime: { published: true } }, select: { animeId: true } },
        },
        take: 100,
      })
    : [];
  const ratings = visibility.ratings
    ? await tx.libraryItem.findMany({
        where: { userId, score: { not: null }, anime: { published: true } },
        select: { animeId: true, score: true },
        take: 2000,
      })
    : [];
  const statistics = visibility.statistics
    ? ([
        await tx.episodeProgress.aggregate({ where: { userId }, _sum: { watchedSeconds: true } }),
        await tx.episodeProgress.findMany({
          where: { userId, completed: true },
          distinct: ["animeId"],
          select: { animeId: true },
          take: 2000,
        }),
      ] as const)
    : null;
  return publicProfile({
    id: userId,
    username: record.username,
    indexable: record.isPublic && record.indexable,
    avatar: record.avatar,
    banner: record.banner,
    badge: record.badge,
    presence: record.presence,
    about: record.about,
    visibility,
    favoriteIds: favorites.map((item) => item.animeId),
    folders: folders.map((folder) => ({
      name: folder.name,
      animeIds: folder.entries.map((entry) => entry.animeId),
    })),
    ratings: ratings.map((item) => ({ animeId: item.animeId, score: item.score! })),
    statistics: {
      watched: statistics?.[1].length ?? 0,
      minutes: Math.floor((statistics?.[0]._sum.watchedSeconds ?? 0) / 60),
    },
  } as ProfileRecord);
}
