CREATE TABLE "Post" (
  "id" UUID PRIMARY KEY, "authorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL DEFAULT 'text', "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'public', "tags" TEXT[] NOT NULL, "labels" TEXT[] NOT NULL,
  "animeId" UUID REFERENCES "Anime"("id") ON DELETE RESTRICT,
  "episodeId" UUID REFERENCES "Episode"("id") ON DELETE RESTRICT,
  "timestamp" INTEGER, "score" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CHECK ("kind" IN ('text','episode','review')),
  CHECK ("audience" IN ('public','friends','private')),
  CHECK ("timestamp" IS NULL OR ("timestamp" BETWEEN 0 AND 86400 AND "episodeId" IS NOT NULL)),
  CHECK ("score" IS NULL OR ("score" BETWEEN 1 AND 10 AND "kind" = 'review')),
  CHECK (("kind" = 'episode' AND "animeId" IS NOT NULL AND "episodeId" IS NOT NULL) OR
         ("kind" = 'review' AND "animeId" IS NOT NULL AND "episodeId" IS NULL) OR
         ("kind" = 'text' AND "episodeId" IS NULL))
);
CREATE INDEX "Post_createdAt_id_idx" ON "Post"("createdAt", "id");
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");
CREATE INDEX "Post_animeId_createdAt_idx" ON "Post"("animeId", "createdAt");
CREATE INDEX "Post_episodeId_createdAt_idx" ON "Post"("episodeId", "createdAt");
CREATE UNIQUE INDEX "Post_active_review_unique" ON "Post"("authorId", "animeId") WHERE "kind" = 'review' AND "deletedAt" IS NULL;
CREATE TABLE "Comment" (
  "id" UUID PRIMARY KEY, "authorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "body" TEXT NOT NULL, "labels" TEXT[] NOT NULL,
  "animeId" UUID REFERENCES "Anime"("id") ON DELETE RESTRICT,
  "episodeId" UUID REFERENCES "Episode"("id") ON DELETE RESTRICT,
  "postId" UUID REFERENCES "Post"("id") ON DELETE CASCADE,
  "parentId" UUID REFERENCES "Comment"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CHECK (num_nonnulls("animeId", "episodeId", "postId") = 1),
  CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE INDEX "Comment_animeId_createdAt_idx" ON "Comment"("animeId", "createdAt");
CREATE INDEX "Comment_episodeId_createdAt_idx" ON "Comment"("episodeId", "createdAt");
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");
