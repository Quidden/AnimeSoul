import { Prisma, type DatabaseTransaction } from "@animesoul/database";
import type { ContentQuery } from "@animesoul/contracts";

type Viewer = { id?: string; adult: boolean };
const adultLabels = ["18+", "nsfw"];

// These SQL predicates mirror ContentService's access policy. Keep ranking and
// aggregates inside PostgreSQL: a feed page must not load every public post.
function authorVisible(authorId: Prisma.Sql, v: Viewer): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "User" u JOIN "UserProfile" profile ON profile."userId" = u.id
    WHERE u.id = ${authorId} AND u."disabledAt" IS NULL
    ${
      v.id
        ? Prisma.sql`AND NOT EXISTS (
      SELECT 1 FROM "UserBlock" b
      WHERE (b."blockerId" = u.id AND b."targetId" = ${v.id}::uuid)
         OR (b."targetId" = u.id AND b."blockerId" = ${v.id}::uuid)
    )`
        : Prisma.empty
    }
  )`;
}

function postVisible(v: Viewer): Prisma.Sql {
  return Prisma.sql`p."deletedAt" IS NULL
    AND ${authorVisible(Prisma.sql`p."authorId"`, v)}
    AND (p."animeId" IS NULL OR EXISTS (
      SELECT 1 FROM "Anime" a WHERE a.id = p."animeId" AND a.published
    ))
    AND (p.audience = 'public' ${
      v.id
        ? Prisma.sql`OR p."authorId" = ${v.id}::uuid
      OR (p.audience = 'friends' AND EXISTS (
        SELECT 1 FROM "Friendship" f
        WHERE (f."lowId" = p."authorId" AND f."highId" = ${v.id}::uuid)
           OR (f."highId" = p."authorId" AND f."lowId" = ${v.id}::uuid)
      ))`
        : Prisma.empty
    })
    ${v.adult ? Prisma.empty : Prisma.sql`AND NOT (p.labels && ${adultLabels}::text[])`}`;
}

function commentVisible(v: Viewer): Prisma.Sql {
  return Prisma.sql`c."deletedAt" IS NULL
    AND ${authorVisible(Prisma.sql`c."authorId"`, v)}
    ${v.adult ? Prisma.empty : Prisma.sql`AND NOT (c.labels && ${adultLabels}::text[])`}
    AND (c."parentId" IS NULL OR EXISTS (
      SELECT 1 FROM "Comment" parent WHERE parent.id = c."parentId"
      AND ${authorVisible(Prisma.sql`parent."authorId"`, v)}
      ${v.adult ? Prisma.empty : Prisma.sql`AND NOT (parent.labels && ${adultLabels}::text[])`}
    ))`;
}

function postFilters(q: ContentQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [];
  if (q.authorId) filters.push(Prisma.sql`p."authorId" = ${q.authorId}::uuid`);
  if (q.animeId) filters.push(Prisma.sql`p."animeId" = ${q.animeId}::uuid`);
  if (q.episodeId) filters.push(Prisma.sql`p."episodeId" = ${q.episodeId}::uuid`);
  if (q.tag) filters.push(Prisma.sql`${q.tag.toLowerCase()} = ANY(p.tags)`);
  if (q.kind) filters.push(Prisma.sql`p.kind = ${q.kind}`);
  if (q.pinned) filters.push(Prisma.sql`p.pinned = ${q.pinned === "true"}`);
  if (q.q)
    filters.push(Prisma.sql`(
    strpos(lower(p.title), lower(${q.q})) > 0 OR strpos(lower(p.body), lower(${q.q})) > 0
  )`);
  if (q.section === "reviews") filters.push(Prisma.sql`p.kind = 'review'`);
  else if (q.section === "posts" || (q.authorId && !q.kind))
    filters.push(Prisma.sql`p.kind <> 'review'`);
  return filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty;
}

export type RankedPost = {
  id: string;
  createdAt: Date;
  activity: Date;
  commentCount: number;
};

export async function rankedPosts(tx: DatabaseTransaction, v: Viewer, q: ContentQuery) {
  const rank = q.sort === "top" ? Prisma.sql`"commentCount"` : Prisma.sql`activity`;
  const cursorRank =
    q.sort === "top"
      ? Prisma.sql`${q.beforeCount ?? 0}::int`
      : Prisma.sql`${q.beforeActivity ? new Date(q.beforeActivity) : new Date(0)}::timestamp`;
  return tx.$queryRaw<RankedPost[]>(Prisma.sql`
    WITH ranked AS (
      SELECT p.id, p."createdAt", COUNT(c.id)::int AS "commentCount",
        GREATEST(p."createdAt", MAX(c."createdAt")) AS activity
      FROM "Post" p
      LEFT JOIN "Comment" c ON c."postId" = p.id AND ${commentVisible(v)}
      WHERE ${postVisible(v)} ${postFilters(q)}
      GROUP BY p.id
    )
    SELECT * FROM ranked
    ${
      q.before && q.beforeId
        ? Prisma.sql`WHERE (${rank}, "createdAt", id) < (
      ${cursorRank}, ${new Date(q.before)}::timestamp, ${q.beforeId}::uuid
    )`
        : Prisma.empty
    }
    ORDER BY ${rank} DESC, "createdAt" DESC, id DESC LIMIT 21
  `);
}

export async function popularTags(
  tx: DatabaseTransaction,
  v: Viewer,
  since: Date,
  until: Date,
  limit: number,
) {
  return tx.$queryRaw<{ tag: string; count: number }[]>(Prisma.sql`
    WITH tagged AS (
      SELECT DISTINCT p.id, unnest(p.tags) AS tag FROM "Post" p
      WHERE ${postVisible(v)} AND p.audience = 'public'
        AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
    )
    SELECT tag, COUNT(*)::int AS count FROM tagged
    GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ${limit}
  `);
}
