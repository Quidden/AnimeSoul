ALTER TABLE "Post" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Post_pinned_createdAt_id_idx" ON "Post"("pinned", "createdAt", "id");
CREATE INDEX "Post_tags_idx" ON "Post" USING GIN ("tags");
CREATE INDEX "Comment_active_post_createdAt_idx" ON "Comment"("postId", "createdAt", "id") WHERE "deletedAt" IS NULL;
