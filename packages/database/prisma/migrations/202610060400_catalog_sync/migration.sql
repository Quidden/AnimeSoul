-- AlterTable
ALTER TABLE "Anime" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "CatalogImportJob" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yummy',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "offset" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "lastFingerprint" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMappingConflict" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "incomingAnimeId" UUID NOT NULL,
    "existingAnimeId" UUID,
    "previousExternalId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "reason" TEXT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderMappingConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMappingOverride" (
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "animeId" UUID NOT NULL,

    CONSTRAINT "ProviderMappingOverride_pkey" PRIMARY KEY ("provider","externalId")
);

-- CreateIndex
CREATE INDEX "CatalogImportJob_status_nextRunAt_idx" ON "CatalogImportJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ProviderMappingConflict_status_lastSeenAt_idx" ON "ProviderMappingConflict"("status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMappingConflict_provider_externalId_incomingAnimeId_key" ON "ProviderMappingConflict"("provider", "externalId", "incomingAnimeId");

-- AddForeignKey
ALTER TABLE "ProviderMappingConflict" ADD CONSTRAINT "ProviderMappingConflict_incomingAnimeId_fkey" FOREIGN KEY ("incomingAnimeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMappingConflict" ADD CONSTRAINT "ProviderMappingConflict_existingAnimeId_fkey" FOREIGN KEY ("existingAnimeId") REFERENCES "Anime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMappingOverride" ADD CONSTRAINT "ProviderMappingOverride_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CatalogImportJob_one_active" ON "CatalogImportJob" ("provider") WHERE "status" IN ('queued', 'running', 'paused');
ALTER TABLE "CatalogImportJob" ADD CONSTRAINT "CatalogImportJob_status_check" CHECK ("status" IN ('queued','running','paused','completed','failed','cancelled'));
-- Search materialization covers imports, seeds and future editorial writes alike.
CREATE FUNCTION animesoul_anime_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := concat_ws(' ', NEW."title", NEW."originalTitle", array_to_string(NEW."aliases", ' '));
  RETURN NEW;
END;
$$;
CREATE TRIGGER anime_search BEFORE INSERT OR UPDATE OF "title", "originalTitle", "aliases" ON "Anime" FOR EACH ROW EXECUTE FUNCTION animesoul_anime_search();
UPDATE "Anime" SET "searchText" = concat_ws(' ', "title", "originalTitle", array_to_string("aliases", ' '));
