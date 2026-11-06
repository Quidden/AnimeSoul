import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  canSee,
  episodeHref,
  readVisibility,
  type ContentQuery,
  type postInputSchema,
  type commentInputSchema,
  type contentTagsQuerySchema,
} from "@animesoul/contracts";
import type { DatabaseTransaction, Prisma } from "@animesoul/database";
import type { z } from "zod";
import { AuthService, cookieToken, type AuthRequest } from "../auth/auth.service.js";
import { digest } from "../auth/security.js";
import { blocked, friends, person, personSelect } from "../social/access.js";
import { popularTags, rankedPosts } from "./community-queries.js";
const adultLabels = ["18+", "nsfw"];
type Viewer = { id?: string; adult: boolean };
function searchText(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
function preferences(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function pageWhere(q: ContentQuery) {
  return q.before && q.beforeId
    ? {
        OR: [
          { createdAt: { lt: new Date(q.before) } },
          { createdAt: new Date(q.before), id: { lt: q.beforeId } },
        ],
      }
    : {};
}
function page<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    next:
      rows.length > limit && last
        ? { before: last.createdAt.toISOString(), beforeId: last.id }
        : null,
  };
}
@Injectable()
export class ContentService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private async viewer(request: AuthRequest): Promise<Viewer> {
    if (!cookieToken(request, "web")) return { adult: false };
    try {
      const s = await this.auth.requireSession(request);
      return {
        id: s.userId,
        adult: preferences(s.user.profile?.preferences).adultContent === true,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) return { adult: false };
      throw error;
    }
  }
  private authors(v: Viewer): Prisma.UserWhereInput {
    return {
      disabledAt: null,
      profile: { isNot: null },
      ...(v.id
        ? { blocks: { none: { targetId: v.id } }, blockedBy: { none: { blockerId: v.id } } }
        : {}),
    };
  }
  private postsWhere(v: Viewer): Prisma.PostWhereInput {
    return {
      deletedAt: null,
      author: this.authors(v),
      AND: [
        { OR: [{ animeId: null }, { anime: { published: true } }] },
        {
          OR: [
            { audience: "public" },
            ...(v.id
              ? [
                  { authorId: v.id },
                  {
                    audience: "friends",
                    author: {
                      OR: [
                        { friendshipsLow: { some: { highId: v.id } } },
                        { friendshipsHigh: { some: { lowId: v.id } } },
                      ],
                    },
                  },
                ]
              : []),
          ],
        },
        ...(!v.adult ? [{ NOT: { labels: { hasSome: adultLabels } } }] : []),
      ],
    };
  }
  private commentsWhere(v: Viewer): Prisma.CommentWhereInput {
    return {
      author: this.authors(v),
      AND: [
        {
          OR: [
            { anime: { published: true } },
            { episode: { anime: { published: true } } },
            { post: this.postsWhere(v) },
          ],
        },
        {
          OR: [
            { parentId: null },
            {
              parent: {
                author: this.authors(v),
                ...(!v.adult ? { NOT: { labels: { hasSome: adultLabels } } } : {}),
              },
            },
          ],
        },
        ...(!v.adult ? [{ NOT: { labels: { hasSome: adultLabels } } }] : []),
      ],
    };
  }
  private async section(
    tx: DatabaseTransaction,
    v: Viewer,
    q: ContentQuery,
    section: "posts" | "reviews" | "comments",
  ) {
    if (!q.authorId) return;
    const p = await tx.userProfile.findFirst({
      where: { userId: q.authorId, user: this.authors(v) },
    });
    const own = v.id === q.authorId,
      friend = !!v.id && !own && (await friends(tx, v.id, q.authorId));
    if (
      !p ||
      !canSee(
        p.isPublic ? "public" : p.profileAccess === "friends" ? "friends" : "private",
        own,
        friend,
      ) ||
      !canSee(readVisibility(p.visibility)[section], own, friend)
    )
      throw new NotFoundException();
  }
  private async target(
    tx: DatabaseTransaction,
    v: Viewer,
    q: {
      animeId?: string | null | undefined;
      episodeId?: string | null | undefined;
      postId?: string | null | undefined;
    },
  ) {
    if ([q.animeId, q.episodeId, q.postId].filter(Boolean).length > 1)
      throw new BadRequestException();
    if (q.postId) {
      const p = await tx.post.findFirst({ where: { id: q.postId, ...this.postsWhere(v) } });
      if (!p) throw new NotFoundException();
      return p.labels;
    }
    if (
      q.episodeId &&
      !(await tx.episode.findFirst({ where: { id: q.episodeId, anime: { published: true } } }))
    )
      throw new NotFoundException();
    if (q.animeId && !(await tx.anime.findFirst({ where: { id: q.animeId, published: true } })))
      throw new NotFoundException();
    return [] as string[];
  }
  async posts(request: AuthRequest, q: ContentQuery) {
    const v = await this.viewer(request);
    return this.auth.db.$transaction(
      async (tx) => {
        await this.section(
          tx,
          v,
          q,
          q.section === "reviews" || q.kind === "review" ? "reviews" : "posts",
        );
        if (q.sort === "discussed" || q.sort === "top") {
          const ranked = await rankedPosts(tx, v, q),
            result = page(ranked, 20),
            rows = await tx.post.findMany({ where: { id: { in: result.items.map((p) => p.id) } } }),
            last = result.items.at(-1);
          return {
            items: await this.postDtos(
              tx,
              result.items.map((p) => rows.find((row) => row.id === p.id)!),
              v,
            ),
            next:
              result.next && last
                ? {
                    ...result.next,
                    ...(q.sort === "top"
                      ? { beforeCount: last.commentCount }
                      : { beforeActivity: last.activity.toISOString() }),
                  }
                : null,
          };
        }
        const rows = await tx.post.findMany({
          where: {
            AND: [
              this.postsWhere(v),
              pageWhere(q),
              ...(q.authorId ? [{ authorId: q.authorId }] : []),
              ...(q.animeId ? [{ animeId: q.animeId }] : []),
              ...(q.episodeId ? [{ episodeId: q.episodeId }] : []),
              ...(q.tag ? [{ tags: { has: q.tag.toLowerCase() } }] : []),
              ...(q.kind ? [{ kind: q.kind }] : []),
              ...(q.pinned ? [{ pinned: q.pinned === "true" }] : []),
              ...(q.q
                ? [
                    {
                      OR: [
                        { title: { contains: searchText(q.q), mode: "insensitive" as const } },
                        { body: { contains: searchText(q.q), mode: "insensitive" as const } },
                      ],
                    },
                  ]
                : []),
              ...(q.section === "reviews"
                ? [{ kind: "review" }]
                : q.section === "posts" || (q.authorId && !q.kind)
                  ? [{ kind: { not: "review" } }]
                  : []),
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 21,
        });
        const result = page(rows, 20);
        return { ...result, items: await this.postDtos(tx, result.items, v) };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async tags(request: AuthRequest, q: z.infer<typeof contentTagsQuerySchema>) {
    const v = await this.viewer(request),
      until = new Date(),
      days = { day: 1, week: 7, month: 30 }[q.period],
      since = new Date(until.getTime() - days * 86400000);
    const items = await this.auth.db.$transaction((tx) =>
      popularTags(tx, v, since, until, q.limit),
    );
    return { items, period: q.period, since: since.toISOString(), until: until.toISOString() };
  }
  private async postDtos(
    tx: DatabaseTransaction,
    rows: Prisma.PostGetPayload<object>[],
    v: Viewer,
  ) {
    // Load related records in batches, sequentially on the transaction's single connection.
    const authors = await tx.userProfile.findMany({
      where: { userId: { in: rows.map((p) => p.authorId) } },
      select: personSelect,
    });
    const anime = await tx.anime.findMany({
      where: { id: { in: rows.flatMap((p) => (p.animeId ? [p.animeId] : [])) } },
      select: { id: true, slug: true, title: true },
    });
    const episodes = await tx.episode.findMany({
      where: { id: { in: rows.flatMap((p) => (p.episodeId ? [p.episodeId] : [])) } },
      select: { id: true, season: true, number: true },
    });
    const counts = await tx.comment.groupBy({
      by: ["postId"],
      where: {
        AND: [this.commentsWhere(v), { postId: { in: rows.map((p) => p.id) }, deletedAt: null }],
      },
      _count: { _all: true },
    });
    return rows.map((p) => ({
      id: p.id,
      author: person(authors.find((a) => a.userId === p.authorId)!),
      kind: p.kind,
      title: p.title,
      body: p.body,
      audience: p.audience,
      tags: p.tags,
      labels: p.labels,
      anime: anime.find((a) => a.id === p.animeId) ?? null,
      episode: episodes.find((e) => e.id === p.episodeId) ?? null,
      timestamp: p.timestamp,
      score: p.score,
      pinned: p.pinned,
      commentCount: counts.find((c) => c.postId === p.id)?._count._all ?? 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }
  async post(request: AuthRequest, id: string) {
    const v = await this.viewer(request);
    return this.auth.db.$transaction(
      async (tx) => {
        const p = await tx.post.findFirst({
          where: { id, ...this.postsWhere(v) },
        });
        if (!p) throw new NotFoundException();
        return (await this.postDtos(tx, [p], v))[0]!;
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async comments(request: AuthRequest, q: ContentQuery) {
    if (q.sort || q.kind || q.pinned || q.tag || q.beforeActivity || q.beforeCount !== undefined)
      throw new BadRequestException("Post filters are not supported for comments.");
    const global = !q.authorId && !q.animeId && !q.episodeId && !q.postId;
    const v = await this.viewer(request);
    return this.auth.db.$transaction(
      async (tx) => {
        await this.section(tx, v, q, "comments");
        await this.target(tx, v, q);
        const result = page(
          await tx.comment.findMany({
            where: {
              AND: [
                this.commentsWhere(v),
                pageWhere(q),
                ...(global
                  ? [{ deletedAt: null, OR: [{ postId: null }, { post: { audience: "public" } }] }]
                  : []),
                ...(q.q
                  ? [{ body: { contains: searchText(q.q), mode: "insensitive" as const } }]
                  : []),
                ...(q.authorId ? [{ authorId: q.authorId }] : []),
                ...(q.animeId
                  ? [
                      q.discussions === "all"
                        ? {
                            OR: [
                              { animeId: q.animeId },
                              { episode: { animeId: q.animeId } },
                              { post: { animeId: q.animeId } },
                            ],
                          }
                        : { animeId: q.animeId },
                    ]
                  : []),
                ...(q.episodeId ? [{ episodeId: q.episodeId }] : []),
                ...(q.postId ? [{ postId: q.postId }] : []),
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 51,
          }),
          50,
        );
        const authors = await tx.userProfile.findMany({
          where: { userId: { in: result.items.map((c) => c.authorId) } },
          select: personSelect,
        });
        const episodes = await tx.episode.findMany({
          where: { id: { in: result.items.flatMap((c) => (c.episodeId ? [c.episodeId] : [])) } },
          select: { id: true, animeId: true },
        });
        const anime = await tx.anime.findMany({
          where: {
            id: {
              in: [
                ...result.items.flatMap((c) => (c.animeId ? [c.animeId] : [])),
                ...episodes.map((e) => e.animeId),
              ],
            },
          },
          select: { id: true, slug: true },
        });
        return {
          ...result,
          items: result.items.map((c) => ({
            id: c.id,
            href: c.postId
              ? "/posts/" + c.postId
              : c.episodeId
                ? episodeHref(
                    anime.find((a) => a.id === episodes.find((e) => e.id === c.episodeId)!.animeId)!
                      .slug,
                    c.episodeId,
                  )
                : "/anime/" + anime.find((a) => a.id === c.animeId)!.slug,
            author: person(authors.find((a) => a.userId === c.authorId)!),
            body: c.deletedAt ? "" : c.body,
            labels: c.labels,
            parentId: c.parentId,
            animeId: c.animeId,
            episodeId: c.episodeId,
            postId: c.postId,
            deleted: !!c.deletedAt,
            createdAt: c.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  private async throttle(id: string) {
    const key = digest("content:" + id),
      now = new Date(),
      cutoff = new Date(now.getTime() - 60000);
    const rows = await this.auth.db.$queryRaw<
      { attempts: number }[]
    >`INSERT INTO "AuthThrottle" ("key","attempts","windowStartedAt") VALUES (${key},1,${now}) ON CONFLICT ("key") DO UPDATE SET "attempts"=CASE WHEN "AuthThrottle"."windowStartedAt" < ${cutoff} THEN 1 ELSE "AuthThrottle"."attempts"+1 END,"windowStartedAt"=CASE WHEN "AuthThrottle"."windowStartedAt" < ${cutoff} THEN ${now} ELSE "AuthThrottle"."windowStartedAt" END RETURNING "attempts"`;
    if (rows[0]!.attempts > 30) throw new HttpException("Too many publications.", 429);
  }
  private async lock(tx: DatabaseTransaction, ids: string[]) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"::text = ANY(${[...new Set(ids)].sort()}) ORDER BY "id" FOR UPDATE`;
  }
  async writePost(request: AuthRequest, input: z.infer<typeof postInputSchema>) {
    const { userId } = await this.auth.writeSession(request);
    await this.throttle(userId);
    try {
      return await this.auth.db.$transaction(async (tx) => {
        await this.lock(tx, [userId]);
        if (
          input.id &&
          !(await tx.post.findFirst({ where: { id: input.id, authorId: userId, deletedAt: null } }))
        )
          throw new NotFoundException();
        if (
          input.animeId &&
          !(await tx.anime.findFirst({ where: { id: input.animeId, published: true } }))
        )
          throw new NotFoundException();
        if (input.episodeId) {
          const ep = await tx.episode.findFirst({
            where: { id: input.episodeId, animeId: input.animeId! },
          });
          if (!ep || (ep.duration && (input.timestamp ?? 0) > ep.duration))
            throw new BadRequestException("Invalid episode or timestamp.");
        }
        const { id, ...fields } = input,
          data = { ...fields, ...(fields.audience !== "public" ? { pinned: false } : {}) };
        const row = id
          ? await tx.post.update({ where: { id }, data })
          : await tx.post.create({ data: { ...data, authorId: userId } });
        await tx.auditEvent.create({
          data: { actorId: userId, action: id ? "post.edited" : "post.created", objectId: row.id },
        });
        return { id: row.id };
      });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002")
        throw new ConflictException("Review already exists.");
      throw error;
    }
  }
  async writeComment(request: AuthRequest, input: z.infer<typeof commentInputSchema>) {
    const s = await this.auth.writeSession(request),
      v: Viewer = {
        id: s.userId,
        adult: preferences(s.user.profile?.preferences).adultContent === true,
      };
    await this.throttle(s.userId);
    return this.auth.db.$transaction(async (tx) => {
      const post = input.postId ? await tx.post.findUnique({ where: { id: input.postId } }) : null;
      const parent = input.parentId
        ? await tx.comment.findUnique({ where: { id: input.parentId } })
        : null;
      await this.lock(tx, [
        s.userId,
        ...(post ? [post.authorId] : []),
        ...(parent ? [parent.authorId] : []),
      ]);
      const inherited = await this.target(tx, v, input);
      if (input.parentId) {
        const visible = await tx.comment.findFirst({
          where: { id: input.parentId, ...this.commentsWhere(v) },
        });
        if (
          !visible ||
          visible.deletedAt ||
          visible.parentId ||
          visible.postId !== input.postId ||
          visible.animeId !== input.animeId ||
          visible.episodeId !== input.episodeId ||
          (await blocked(tx, s.userId, visible.authorId))
        )
          throw new NotFoundException();
        inherited.push(...visible.labels);
      }
      const { id, ...fields } = input,
        data = { ...fields, labels: [...new Set([...input.labels, ...inherited])] };
      if (id) {
        const old = await tx.comment.findFirst({
          where: { id, authorId: s.userId, deletedAt: null },
        });
        if (
          !old ||
          old.animeId !== input.animeId ||
          old.episodeId !== input.episodeId ||
          old.postId !== input.postId ||
          old.parentId !== input.parentId
        )
          throw new NotFoundException();
      }
      const row = id
        ? await tx.comment.update({ where: { id }, data })
        : await tx.comment.create({ data: { ...data, authorId: s.userId } });
      await tx.auditEvent.create({
        data: {
          actorId: s.userId,
          action: id ? "comment.edited" : "comment.created",
          objectId: row.id,
        },
      });
      return { id: row.id };
    });
  }
  async remove(request: AuthRequest, id: string, kind: "post" | "comment") {
    const { userId } = await this.auth.writeSession(request);
    return this.auth.db.$transaction(async (tx) => {
      await this.lock(tx, [userId]);
      const changed =
        kind === "post"
          ? await tx.post.updateMany({
              where: { id, authorId: userId, deletedAt: null },
              data: { deletedAt: new Date() },
            })
          : await tx.comment.updateMany({
              where: { id, authorId: userId, deletedAt: null },
              data: { deletedAt: new Date(), body: "" },
            });
      if (changed.count !== 1) throw new NotFoundException();
      await tx.auditEvent.create({
        data: { actorId: userId, action: kind + ".deleted", objectId: id },
      });
      return { ok: true };
    });
  }
  async preference(request: AuthRequest, enabled: boolean) {
    const { userId } = await this.auth.writeSession(request);
    return this.auth.db.$transaction(async (tx) => {
      await this.lock(tx, [userId]);
      const p = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
      await tx.userProfile.update({
        where: { userId },
        data: { preferences: { ...preferences(p.preferences), adultContent: enabled } },
      });
      return { ok: true };
    });
  }
}
