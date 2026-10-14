import type { DatabaseTransaction, Prisma } from "@animesoul/database";

export function socialPair(a: string, b: string) {
  return a < b ? { lowId: a, highId: b } : { lowId: b, highId: a };
}
export async function blocked(tx: DatabaseTransaction, a: string, b: string) {
  return Boolean(
    await tx.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, targetId: b },
          { blockerId: b, targetId: a },
        ],
      },
      select: { blockerId: true },
    }),
  );
}
export async function friends(tx: DatabaseTransaction, a: string, b: string) {
  return Boolean(await tx.friendship.findUnique({ where: { lowId_highId: socialPair(a, b) } }));
}
/** The same policy is used for directory results, lists and profile sections. */
export function visiblePeople(viewer?: string): Prisma.UserProfileWhereInput {
  if (!viewer) return { isPublic: true, user: { disabledAt: null } };
  return {
    user: {
      disabledAt: null,
      blocks: { none: { targetId: viewer } },
      blockedBy: { none: { blockerId: viewer } },
    },
    OR: [
      { userId: viewer },
      { isPublic: true },
      {
        profileAccess: "friends",
        user: {
          OR: [
            { friendshipsLow: { some: { highId: viewer } } },
            { friendshipsHigh: { some: { lowId: viewer } } },
          ],
        },
      },
    ],
  };
}
export const personSelect = { userId: true, username: true, avatar: true } as const;
export function person(record: { userId: string; username: string; avatar: string | null }) {
  return { id: record.userId, username: record.username, avatar: record.avatar };
}
export async function profileFriends(
  tx: DatabaseTransaction,
  userId: string,
  viewer?: string,
  after?: string,
) {
  const rows = await tx.userProfile.findMany({
    where: {
      AND: [
        viewer === userId
          ? {
              user: {
                disabledAt: null,
                blocks: { none: { targetId: viewer } },
                blockedBy: { none: { blockerId: viewer } },
              },
            }
          : visiblePeople(viewer),
        {
          user: {
            OR: [
              { friendshipsLow: { some: { highId: userId } } },
              { friendshipsHigh: { some: { lowId: userId } } },
            ],
          },
        },
        ...(after ? [{ userId: { gt: after } }] : []),
      ],
    },
    select: personSelect,
    orderBy: { userId: "asc" },
    take: 51,
  });
  return { items: rows.slice(0, 50).map(person), next: rows.length > 50 ? rows[49]!.userId : null };
}
