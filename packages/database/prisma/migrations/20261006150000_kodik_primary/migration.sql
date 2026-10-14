-- AlterTable
ALTER TABLE "Anime" ADD COLUMN     "metadataProvider" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "CatalogImportJob" ADD COLUMN     "cursor" TEXT,
ALTER COLUMN "strategy" SET DEFAULT 'kodik-cursor',
ALTER COLUMN "provider" SET DEFAULT 'kodik';

-- CreateTable
CREATE TABLE "KodikRelease" (
    "id" TEXT NOT NULL,
    "animeId" UUID NOT NULL,

    CONSTRAINT "KodikRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportPage" (
    "jobId" UUID NOT NULL,
    "cursorHash" TEXT NOT NULL,

    CONSTRAINT "CatalogImportPage_pkey" PRIMARY KEY ("jobId","cursorHash")
);

-- CreateIndex
CREATE INDEX "KodikRelease_animeId_idx" ON "KodikRelease"("animeId");

-- CreateIndex
CREATE INDEX "Anime_metadataProvider_published_title_idx" ON "Anime"("metadataProvider", "published", "title");

-- AddForeignKey
ALTER TABLE "KodikRelease" ADD CONSTRAINT "KodikRelease_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportPage" ADD CONSTRAINT "CatalogImportPage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CatalogImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Preserve legacy metadata and URLs for direct/library access while the catalog switches to Kodik.
UPDATE "Anime" SET "metadataProvider" = 'legacy' WHERE "isDevelopment" = false AND EXISTS (SELECT 1 FROM "AnimeProvider" WHERE "animeId" = "Anime"."id" AND "provider" = 'yummy');
UPDATE "CatalogImportJob" SET "status" = 'cancelled', "finishedAt" = CURRENT_TIMESTAMP, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = 'legacy-catalog-disabled' WHERE "provider" = 'yummy' AND "status" IN ('queued','running','paused');
