ALTER TABLE "Anime"
  ADD COLUMN "shikimoriScore" DOUBLE PRECISION,
  ADD COLUMN "shikimoriVotes" INTEGER,
  ADD COLUMN "popularity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "format" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "translations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "franchiseSize" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Anime" ADD CONSTRAINT "Anime_external_score_range" CHECK ("shikimoriScore" IS NULL OR "shikimoriScore" BETWEEN 0 AND 10);
CREATE INDEX "Anime_published_shikimoriScore_idx" ON "Anime"("published", "shikimoriScore");
CREATE INDEX "Anime_published_status_popularity_idx" ON "Anime"("published", "status", "popularity");
