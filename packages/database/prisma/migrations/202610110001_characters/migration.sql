ALTER TABLE "Anime" ADD COLUMN "charactersFetchedAt" TIMESTAMP(3);

CREATE TABLE "Character" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'shikimori',
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "japaneseName" TEXT NOT NULL DEFAULT '',
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "description" TEXT NOT NULL DEFAULT '',
  "image" TEXT,
  "sourceUrl" TEXT,
  "voiceActors" JSONB NOT NULL DEFAULT '[]',
  "appearanceExternalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "detailsFetchedAt" TIMESTAMP(3),
  "isDevelopment" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Character_slug_key" ON "Character"("slug");
CREATE UNIQUE INDEX "Character_provider_externalId_key" ON "Character"("provider", "externalId");
CREATE INDEX "Character_name_idx" ON "Character"("name");

CREATE TABLE "AnimeCharacter" (
  "animeId" UUID NOT NULL,
  "characterId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnimeCharacter_pkey" PRIMARY KEY ("animeId", "characterId"),
  CONSTRAINT "AnimeCharacter_role_check" CHECK ("role" IN ('main', 'supporting', 'background'))
);
CREATE INDEX "AnimeCharacter_characterId_idx" ON "AnimeCharacter"("characterId");
ALTER TABLE "AnimeCharacter" ADD CONSTRAINT "AnimeCharacter_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnimeCharacter" ADD CONSTRAINT "AnimeCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
