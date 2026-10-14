CREATE TABLE "Episode" (
  "id" UUID NOT NULL PRIMARY KEY,
  "animeId" UUID NOT NULL REFERENCES "Anime"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "season" TEXT NOT NULL, "number" TEXT NOT NULL, "duration" DOUBLE PRECISION,
  CONSTRAINT "Episode_duration_check" CHECK ("duration" IS NULL OR ("duration" > 0 AND "duration" <= 86400)),
  CONSTRAINT "Episode_labels_check" CHECK (length("season") BETWEEN 1 AND 30 AND length("number") BETWEEN 1 AND 30)
);
CREATE UNIQUE INDEX "Episode_animeId_season_number_key" ON "Episode"("animeId", "season", "number");
CREATE UNIQUE INDEX "Episode_id_animeId_key" ON "Episode"("id", "animeId");
CREATE TABLE "EpisodeProvider" (
  "provider" TEXT NOT NULL, "animeId" UUID NOT NULL, "externalId" TEXT NOT NULL, "episodeId" UUID NOT NULL,
  PRIMARY KEY ("provider", "animeId", "externalId"),
  FOREIGN KEY ("episodeId", "animeId") REFERENCES "Episode"("id", "animeId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EpisodeProvider_episodeId_idx" ON "EpisodeProvider"("episodeId");
ALTER TABLE "EpisodeProgress" ADD COLUMN "episodeId" UUID, ADD COLUMN "activePlaybackId" UUID;
ALTER TABLE "EpisodeProgress" ADD CONSTRAINT "EpisodeProgress_episodeId_animeId_fkey" FOREIGN KEY ("episodeId", "animeId") REFERENCES "Episode"("id", "animeId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "PlaybackSession" (
  "id" UUID NOT NULL PRIMARY KEY, "userId" UUID NOT NULL, "authSessionId" UUID NOT NULL,
  "animeId" UUID NOT NULL, "episodeId" UUID NOT NULL, "sequence" INTEGER NOT NULL DEFAULT 0,
  "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("authSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("episodeId", "animeId") REFERENCES "Episode"("id", "animeId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PlaybackSession_expiresAt_idx" ON "PlaybackSession"("expiresAt");
CREATE INDEX "PlaybackSession_userId_idx" ON "PlaybackSession"("userId");
