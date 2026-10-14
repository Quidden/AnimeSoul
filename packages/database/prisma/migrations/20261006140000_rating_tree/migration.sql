CREATE TABLE "LibraryRating" (
  "userId" UUID NOT NULL,
  "animeId" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  CONSTRAINT "LibraryRating_pkey" PRIMARY KEY ("userId", "animeId", "scope", "key"),
  CONSTRAINT "LibraryRating_score_check" CHECK ("score" BETWEEN 1 AND 10),
  CONSTRAINT "LibraryRating_scope_check" CHECK ("scope" IN ('season', 'episode')),
  CONSTRAINT "LibraryRating_library_fkey" FOREIGN KEY ("userId", "animeId") REFERENCES "LibraryItem"("userId", "animeId") ON DELETE CASCADE ON UPDATE CASCADE
);
