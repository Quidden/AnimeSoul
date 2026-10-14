-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE "LibraryItem" (
    "userId" UUID NOT NULL,
    "animeId" UUID NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "lastEpisode" TEXT NOT NULL DEFAULT '',
    "dubbing" TEXT NOT NULL DEFAULT '',
    "season" INTEGER NOT NULL DEFAULT 1,
    "progressDetails" JSONB NOT NULL DEFAULT '{}',
    "tracking" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("userId","animeId")
);

-- CreateTable
CREATE TABLE "LibraryFolder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "LibraryFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderEntry" (
    "folderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "animeId" UUID NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FolderEntry_pkey" PRIMARY KEY ("folderId","animeId")
);

-- CreateTable
CREATE TABLE "EpisodeProgress" (
    "userId" UUID NOT NULL,
    "animeId" UUID NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeProgress_pkey" PRIMARY KEY ("userId","animeId","episodeKey")
);

-- CreateTable
CREATE TABLE "LegacyProfile" (
    "legacyId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "claimHash" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "LegacyProfile_pkey" PRIMARY KEY ("legacyId")
);

-- CreateTable
CREATE TABLE "MfaCredential" (
    "userId" UUID NOT NULL,
    "secretEncrypted" TEXT,
    "pendingEncrypted" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "lastCounter" INTEGER NOT NULL DEFAULT -1,
    "recoveryHashes" TEXT[],
    "enabledAt" TIMESTAMP(3),

    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthThrottle" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LibraryFolder_userId_idx" ON "LibraryFolder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryFolder_id_userId_key" ON "LibraryFolder"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyProfile_userId_key" ON "LegacyProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyProfile_claimHash_key" ON "LegacyProfile"("claimHash");

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryFolder" ADD CONSTRAINT "LibraryFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderEntry" ADD CONSTRAINT "FolderEntry_folderId_userId_fkey" FOREIGN KEY ("folderId", "userId") REFERENCES "LibraryFolder"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderEntry" ADD CONSTRAINT "FolderEntry_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeProgress" ADD CONSTRAINT "EpisodeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeProgress" ADD CONSTRAINT "EpisodeProgress_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyProfile" ADD CONSTRAINT "LegacyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 1 AND 10);
ALTER TABLE "Session" ADD CONSTRAINT "Session_audience_check" CHECK ("audience" IN ('web', 'admin'));
